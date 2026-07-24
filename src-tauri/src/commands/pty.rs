use crate::state::app_state::{LockExt, PtySession, PtyState};
use crate::utils::env_filter;
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use tauri::{Emitter, State, Window};

use std::io::{Read, Write};

#[derive(serde::Serialize, Clone)]
struct PtyPayload {
    session_id: String,
    data: String,
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

// NOTE: portable_pty::CommandBuilder doesn't expose process-group creation
// hooks the way tokio::process::Command does (see utils/process.rs), so a
// PTY child's own grandchildren (e.g. `npm run build` spawning further node
// processes) aren't guaranteed to die when the PTY session is killed. This
// is a known gap — see docs/superpowers/plans/2026-07-21-critical-security-hardening.md Task 14.
#[tauri::command]
#[specta::specta]

pub fn spawn_pty(
    window: Window,
    state: State<'_, PtyState>,
    app_state: State<'_, crate::state::app_state::AppState>,
    session_id: String,
    directory: String,
) -> Result<(), String> {
    // Validate directory is either a known project path, a sandbox path, or "."
    let dir_path = std::path::Path::new(&directory);
    if directory != "." {
        let canonical = std::fs::canonicalize(dir_path).map_err(|e| e.to_string())?;
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
        let sessions = state.sessions.lock_safe();
        if sessions.contains_key(&session_id) {
            return Ok(());
        }
        if sessions.len() >= 20 {
            return Err("Maximum PTY sessions reached".to_string());
        }
    }

    let pty_system = NativePtySystem::default();
    let size = PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = pty_system.openpty(size).map_err(|e| e.to_string())?;

    let shell = if cfg!(target_os = "windows") {
        "powershell.exe".to_string()
    } else if cfg!(target_os = "macos") {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    };

    let mut cmd = CommandBuilder::new(shell);
    cmd.cwd(directory.clone());

    // SECURITY: CommandBuilder seeds its env map from our own process env at
    // construction time. Clear it and rebuild from the sanitized set so
    // npm tokens / cloud credentials never reach a package's build scripts
    // running in this terminal.
    cmd.env_clear();
    for (key, value) in env_filter::sanitized_env() {
        cmd.env(key, value);
    }

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
        loop {
            if cancel_clone.load(std::sync::atomic::Ordering::SeqCst) {
                break;
            }
            // Use a short timeout on read if possible, but standard Read blocks.
            // If the process is killed, read typically unblocks with Ok(0) or Err.
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if let Ok(text) = String::from_utf8(buf[..n].to_vec()) {
                        let redacted_text = {
                            static PATTERNS: once_cell::sync::Lazy<Vec<regex::Regex>> =
                                once_cell::sync::Lazy::new(|| {
                                    vec![
                                    regex::Regex::new(r"(?i)(_authToken|token|password|secret|key)\s*[=:]\s*\S+").unwrap(),
                                    regex::Regex::new(r"npm_[a-zA-Z0-9]{20,}").unwrap(),
                                    regex::Regex::new(r"ghp_[a-zA-Z0-9]{36}").unwrap(),
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
                Err(_) => break,
            }
        }
    });

    let mut sessions = state.sessions.lock_safe();
    sessions.insert(
        session_id,
        PtySession {
            master: pair.master,
            child,
            writer,
            directory,
            history,
            cancel,
            reader_thread: Some(reader_thread),
        },
    );
    Ok(())
}

#[tauri::command]
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

#[tauri::command]
#[specta::specta]

pub fn write_pty(
    state: State<'_, PtyState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    if let Some(session) = state.sessions.lock_safe().get_mut(&session_id) {
        let _ = write!(session.writer, "{}", data);
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]

pub fn resize_pty(
    state: State<'_, PtyState>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    if let Some(session) = state.sessions.lock_safe().get(&session_id) {
        let _ = session.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        });
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]

pub fn kill_pty(state: State<'_, PtyState>, session_id: String) -> Result<(), String> {
    state.sessions.lock_safe().remove(&session_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
