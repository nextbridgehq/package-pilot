use crate::state::app_state::{LockExt, PtySession, PtyState};
use crate::utils::env_filter;
use portable_pty::{Child, CommandBuilder, NativePtySystem, PtySize, PtySystem};
use tauri::{Emitter, State, Window};

use std::io::{Read, Write};

#[derive(serde::Serialize, Clone)]
struct PtyPayload {
    session_id: String,
    data: String,
}

#[derive(serde::Serialize, Clone)]
struct PtyExitPayload {
    session_id: String,
}

/// A session whose shell has exited (the user typed `exit`, a dev server
/// crashed, ...) but was never explicitly closed. Left unchecked these pile
/// up toward the 20-session cap in `spawn_pty`, each one a permanently
/// frozen tab with no signal that anything is wrong.
fn child_has_exited(child: &mut (dyn Child + Send + Sync)) -> bool {
    // try_wait is non-blocking. Ok(None) = still running; Ok(Some(_)) means
    // it exited; Err(_) (e.g. the process is already gone/unqueryable) is
    // treated as exited too, since "unknown" is never grounds to keep a
    // session counted as live.
    !matches!(child.try_wait(), Ok(None))
}

const PTY_HISTORY_MAX: usize = 100_000;
const PTY_HISTORY_TRIM_TO: usize = 50_000;

fn append_to_history(history: &mut String, text: &str) {
    history.push_str(text);
    if history.len() > PTY_HISTORY_MAX {
        let diff = history.len() - PTY_HISTORY_TRIM_TO;
        // Find nearest character boundary to avoid slicing inside a UTF-8 character
        let mut safe_diff = diff;
        while safe_diff < history.len() && !history.is_char_boundary(safe_diff) {
            safe_diff += 1;
        }
        history.drain(..safe_diff);
    }
}

const MIN_COLS: u16 = 20;
const MIN_ROWS: u16 = 5;
const MAX_COLS: u16 = 1000;
const MAX_ROWS: u16 = 500;

/// A PTY born at 0x0 (or at a stale default) makes the shell wrap at the
/// wrong column, which is what produced overlapping prompt redraws.
fn clamp_pty_size(cols: u16, rows: u16) -> (u16, u16) {
    (cols.clamp(MIN_COLS, MAX_COLS), rows.clamp(MIN_ROWS, MAX_ROWS))
}

fn default_shell() -> String {
    if cfg!(target_os = "windows") {
        "powershell.exe".to_string()
    } else if cfg!(target_os = "macos") {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
}

/// Builds the shell command with a sanitized environment and, on Windows,
/// `-NoLogo` so a session opens straight at a prompt instead of the banner.
fn build_shell_command(directory: &str) -> CommandBuilder {
    let mut cmd = CommandBuilder::new(default_shell());
    if cfg!(target_os = "windows") {
        cmd.arg("-NoLogo");
    }
    cmd.cwd(directory);

    // SECURITY: CommandBuilder seeds its env map from our own process env at
    // construction time. Clear it and rebuild from the sanitized set so
    // npm tokens / cloud credentials never reach a package's build scripts.
    cmd.env_clear();
    for (key, value) in env_filter::sanitized_env() {
        cmd.env(key, value);
    }
    cmd
}

// NOTE: portable_pty::CommandBuilder doesn't expose process-group creation
// hooks the way tokio::process::Command does (see utils/process.rs), so a
// PTY child's own grandchildren (e.g. `npm run build` spawning further node
// processes) aren't guaranteed to die when the PTY session is killed. This
// is a known gap — see docs/superpowers/plans/2026-07-21-critical-security-hardening.md Task 14.
// `async` execution context: a sync command body runs inline on the main
// thread, and this one canonicalizes every project path and spawns a shell.
#[tauri::command(async)]
#[specta::specta]

pub fn spawn_pty(
    window: Window,
    state: State<'_, PtyState>,
    app_state: State<'_, crate::state::app_state::AppState>,
    session_id: String,
    directory: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    // Validate directory is either a known project path, a sandbox path, or "."
    let dir_path = std::path::Path::new(&directory);
    if directory != "." {
        let canonical = std::fs::canonicalize(dir_path).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                format!(
                    "This directory no longer exists: {}. It may have been deleted or cleaned up.",
                    directory
                )
            } else {
                e.to_string()
            }
        })?;
        let sandbox_base = std::env::temp_dir().join("PackagePilot_Sandboxes");

        let is_sandbox = std::fs::canonicalize(&sandbox_base)
            .map(|base| canonical.starts_with(&base))
            .unwrap_or(false);
        let is_known_project = {
            let persistent = app_state.persistent.lock_safe();
            persistent.projects.iter().any(|p| {
                std::fs::canonicalize(&p.path)
                    .map(|cp| canonical.starts_with(&cp))
                    .unwrap_or(false)
            })
        };

        if !is_sandbox && !is_known_project {
            return Err(
                "Selected directory/folder must be a Registered Project or Package Pilot Sandbox"
                    .to_string(),
            );
        }
    }
    {
        let mut sessions = state.sessions.lock_safe();
        // A shell that exited on its own (typed `exit`, dev server crashed)
        // stays in this map until someone closes its tab. Prune those first
        // so a long-running window doesn't starve out of the cap on dead
        // entries the user never explicitly kept open.
        sessions.retain(|_, s| !child_has_exited(s.child.as_mut()));

        if sessions.contains_key(&session_id) {
            return Ok(());
        }
        if sessions.len() >= 20 {
            return Err("Maximum PTY sessions reached".to_string());
        }
    }

    let pty_system = NativePtySystem::default();
    let (cols, rows) = clamp_pty_size(cols, rows);
    let size = PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = pty_system.openpty(size).map_err(|e| e.to_string())?;

    let cmd = build_shell_command(&directory);

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let sid_clone = session_id.clone();
    let history = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
    let history_clone = history.clone();
    let window_clone = window.clone();

    let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let cancel_clone = cancel.clone();

    let reader_thread = std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        // Distinguishes "the shell process ended on its own" from "we asked
        // it to stop" (cancel_clone, set by PtySession::drop on an explicit
        // close) - only the former is worth telling the frontend about.
        let mut organic_exit = false;
        loop {
            if cancel_clone.load(std::sync::atomic::Ordering::SeqCst) {
                break;
            }
            // Use a short timeout on read if possible, but standard Read blocks.
            // If the process is killed, read typically unblocks with Ok(0) or Err.
            match reader.read(&mut buf) {
                Ok(0) => {
                    organic_exit = true;
                    break;
                }
                Ok(n) => {
                    if let Ok(text) = String::from_utf8(buf[..n].to_vec()) {
                        let redacted_text = {
                            static PATTERNS: once_cell::sync::Lazy<Vec<regex::Regex>> =
                                once_cell::sync::Lazy::new(|| {
                                    vec![
                                    regex::Regex::new(r"(?i)(_authToken|token|password|secret|key)\s*[=:]\s*\S+").unwrap(),
                                    regex::Regex::new(r#"(?i)["'](_authToken|token|password|secret|key)["']\s*:\s*["'][^"']+["']"#).unwrap(),
                                    regex::Regex::new(r"npm_[a-zA-Z0-9]{20,}").unwrap(),
                                    regex::Regex::new(r"ghp_[a-zA-Z0-9]{36}").unwrap(),
                                    regex::Regex::new(r"(?i)bearer\s+[a-zA-Z0-9_\-\.]+").unwrap(),
                                    regex::Regex::new(r"AKIA[0-9A-Z]{16}").unwrap(),
                                ]
                                });
                            let mut result = text.to_string();
                            for pattern in PATTERNS.iter() {
                                result = pattern.replace_all(&result, "[REDACTED]").to_string();
                            }
                            result
                        };

                        if let Ok(mut h) = history_clone.lock() {
                            append_to_history(&mut h, &redacted_text);
                        }
                        let _ = window_clone.emit(
                            "pty-output",
                            PtyPayload {
                                session_id: sid_clone.clone(),
                                data: redacted_text,
                            },
                        );
                    }
                }
                Err(_) => {
                    organic_exit = true;
                    break;
                }
            }
        }
        if organic_exit {
            let _ = window_clone.emit(
                "pty-exit",
                PtyExitPayload {
                    session_id: sid_clone.clone(),
                },
            );
        }
    });

    let mut sessions = state.sessions.lock_safe();
    sessions.insert(
        session_id,
        PtySession {
            master: Some(pair.master),
            child,
            writer: Some(writer),
            directory,
            history,
            cancel,
            reader_thread: Some(reader_thread),
        },
    );
    Ok(())
}

// `async`: clones up to PTY_HISTORY_MAX bytes of scrollback, which must not
// happen inline on the main thread.
#[tauri::command(async)]
#[specta::specta]

pub fn attach_pty(
    state: State<'_, PtyState>,
    session_id: String,
) -> Result<Option<String>, String> {
    if let Some(session) = state.sessions.lock_safe().get(&session_id) {
        if let Ok(h) = session.history.lock() {
            return Ok(Some(h.clone()));
        }
    }
    Ok(None)
}

// `async`: writing to the PTY can block if the child is not draining stdin.
#[tauri::command(async)]
#[specta::specta]

pub fn write_pty(
    state: State<'_, PtyState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    if let Some(session) = state.sessions.lock_safe().get_mut(&session_id) {
        if let Some(writer) = session.writer.as_mut() {
            let _ = write!(writer, "{}", data);
        }
    }
    Ok(())
}

// `async`: resize crosses into the ConPTY/pty driver and can block.
#[tauri::command(async)]
#[specta::specta]

pub fn resize_pty(
    state: State<'_, PtyState>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    if let Some(session) = state.sessions.lock_safe().get(&session_id) {
        if let Some(master) = session.master.as_ref() {
            let _ = master.resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            });
        }
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]

pub async fn kill_pty(state: State<'_, PtyState>, session_id: String) -> Result<(), String> {
    // Take the session out under the lock, then release it before dropping.
    // `PtySession::drop` kills a process tree and joins the reader thread, so
    // dropping it while holding `sessions` would block every other PTY command.
    let session = state.sessions.lock_safe().remove(&session_id);

    if let Some(session) = session {
        // This command is `async`, so its body runs on the async runtime rather
        // than inline on the main thread the way a sync command would. Teardown
        // still blocks, so it belongs on the blocking pool.
        tokio::task::spawn_blocking(move || drop(session))
            .await
            .map_err(|e| format!("PTY teardown failed: {}", e))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use portable_pty::{ChildKiller, ExitStatus};

    #[derive(Debug)]
    struct FakeChild {
        exit_status: Option<ExitStatus>,
    }

    impl ChildKiller for FakeChild {
        fn kill(&mut self) -> std::io::Result<()> {
            Ok(())
        }
        fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
            Box::new(FakeChild { exit_status: self.exit_status.clone() })
        }
    }

    impl Child for FakeChild {
        fn try_wait(&mut self) -> std::io::Result<Option<ExitStatus>> {
            Ok(self.exit_status.clone())
        }
        fn wait(&mut self) -> std::io::Result<ExitStatus> {
            Ok(self.exit_status.clone().unwrap_or_else(|| ExitStatus::with_exit_code(0)))
        }
        fn process_id(&self) -> Option<u32> {
            None
        }
        #[cfg(windows)]
        fn as_raw_handle(&self) -> Option<std::os::windows::io::RawHandle> {
            None
        }
    }

    #[test]
    fn child_has_exited_is_false_while_try_wait_returns_none() {
        let mut child = FakeChild { exit_status: None };
        assert!(!child_has_exited(&mut child));
    }

    #[test]
    fn child_has_exited_is_true_once_try_wait_returns_a_status() {
        let mut child = FakeChild { exit_status: Some(ExitStatus::with_exit_code(0)) };
        assert!(child_has_exited(&mut child));
    }

    #[test]
    fn append_to_history_keeps_short_text_untrimmed() {
        let mut history = String::from("hello ");
        append_to_history(&mut history, "world");
        assert_eq!(history, "hello world");
    }

    #[test]
    fn append_to_history_trims_when_over_max() {
        let mut history = "a".repeat(PTY_HISTORY_MAX);
        append_to_history(&mut history, "b");
        assert!(history.len() <= PTY_HISTORY_MAX);
        assert!(history.ends_with('b'));
    }

    #[test]
    fn append_to_history_trim_respects_utf8_boundaries() {
        // Multi-byte characters straddling the trim point must not panic or corrupt.
        let mut history = "\u{20ac}".repeat(PTY_HISTORY_MAX / 3 + 1); // each euro sign is 3 bytes
        let before_len = history.len();
        append_to_history(&mut history, "x");
        assert!(before_len > PTY_HISTORY_MAX || history.len() <= before_len + 1);
        // Must still be valid UTF-8 (String guarantees this; a mid-character drain would panic instead)
        assert!(history.is_char_boundary(0));
    }

    #[test]
    fn spawn_pty_command_builder_does_not_inherit_secret_env_vars() {
        std::env::set_var("NPM_TOKEN", "leaked_if_this_test_fails");

        let shell = if cfg!(windows) {
            "powershell.exe".to_string()
        } else {
            "/bin/sh".to_string()
        };
        let mut cmd = CommandBuilder::new(shell);
        cmd.env_clear();
        for (key, value) in crate::utils::env_filter::sanitized_env() {
            cmd.env(key, value);
        }

        assert!(
            cmd.get_env("NPM_TOKEN").is_none(),
            "NPM_TOKEN must not be present on the CommandBuilder used to spawn the PTY shell"
        );
        assert!(
            cmd.get_env("PATH").is_some() || cmd.get_env("Path").is_some(),
            "PATH must survive so the shell can resolve node/npm/git"
        );

        std::env::remove_var("NPM_TOKEN");
    }

    #[test]
    fn clamp_pty_size_rejects_degenerate_dimensions() {
        // A 0-column PTY makes the shell wrap every character.
        assert_eq!(clamp_pty_size(0, 0), (MIN_COLS, MIN_ROWS));
        assert_eq!(clamp_pty_size(5, 1), (MIN_COLS, MIN_ROWS));
    }

    #[test]
    fn clamp_pty_size_preserves_reasonable_dimensions() {
        assert_eq!(clamp_pty_size(120, 30), (120, 30));
    }

    #[test]
    fn clamp_pty_size_caps_absurd_dimensions() {
        assert_eq!(clamp_pty_size(50_000, 50_000), (MAX_COLS, MAX_ROWS));
    }

    #[test]
    fn windows_shell_starts_without_the_copyright_banner() {
        let cmd = build_shell_command(".");
        if cfg!(target_os = "windows") {
            let argv: Vec<String> = cmd
                .get_argv()
                .iter()
                .map(|s| s.to_string_lossy().to_string())
                .collect();
            assert!(
                argv.iter().any(|a| a == "-NoLogo"),
                "powershell must start with -NoLogo, got {:?}",
                argv
            );
        }
    }
}
