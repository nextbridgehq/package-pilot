use crate::commands::cmd_name;
use crate::error::AppError;
use crate::utils::{env_filter, process};
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

/// Kills the whole process tree rooted at `pid` when dropped, unless
/// disarmed first (via `pid = None`).
///
/// This replaces `Command::kill_on_drop`, which only reaches the *direct*
/// child. Using both `kill_on_drop(true)` *and* an explicit
/// `kill_process_tree` call in the timeout branch (an earlier version of
/// this function did exactly that) creates a race: `kill_on_drop`'s kill is
/// synchronous and runs the instant the `Child` is dropped, i.e. the moment
/// `tokio::time::timeout` cancels the `wait_with_output()` future — which
/// happens *before* control ever reaches the explicit
/// `process::kill_process_tree(pid)` call below. By the time that call runs,
/// the direct child (e.g. the `npm`/`powershell` process) is already dead,
/// so `taskkill /PID <pid> /T /F` fails with "process not found" and never
/// touches any grandchildren (e.g. `npm -> node -> script`) — silently
/// leaving them orphaned and running. Verified experimentally: killing a
/// direct child first and then running `taskkill /T /F` on its now-dead PID
/// does not reach a still-running grandchild.
///
/// Using a single kill mechanism (this guard) instead of two competing ones
/// removes the race, and also means any future/child-of-`run_command_raw`
/// process leak — not just our own timeout — gets the same full tree-kill,
/// which is strictly better than `kill_on_drop`'s single-process kill.
struct KillTreeOnDrop {
    pid: Option<u32>,
}

impl Drop for KillTreeOnDrop {
    fn drop(&mut self) {
        if let Some(pid) = self.pid.take() {
            let _ = process::kill_process_tree(pid);
        }
    }
}

pub async fn run_command_raw(
    cmd: &str,
    args: &[&str],
    cwd: &str,
    timeout_duration: Duration,
) -> Result<std::process::Output, AppError> {
    crate::utils::validation::validate_shell_arg(cmd)?;
    for arg in args {
        crate::utils::validation::validate_shell_arg(arg)?;
    }

    let mut command = Command::new(cmd_name(cmd));
    command
        .args(args)
        .current_dir(cwd)
        // Deliberately NOT kill_on_drop(true) — see KillTreeOnDrop's doc
        // comment above for why that would race against, and defeat, the
        // explicit tree-kill below.
        .env_clear()
        .envs(env_filter::sanitized_env())
        // `.output()` (the method this replaces) implicitly configured stdin
        // as null and stdout/stderr as piped so it could collect them. Plain
        // `.spawn()` defaults to inheriting the parent's stdio instead, which
        // would silently stop `run_command_raw` from ever capturing output
        // (every caller that parses stdout, e.g. `run_command`, would break)
        // and would leak the spawned process's stdio into whatever is
        // currently attached to this process's stdin/stdout/stderr. Set the
        // same configuration `.output()` used, explicitly.
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    process::command_in_new_group(&mut command);

    let child = command
        .spawn()
        .map_err(|e| AppError::Generic(format!("Failed to spawn {}: {}", cmd, e)))?;
    let mut guard = KillTreeOnDrop { pid: child.id() };

    let output_result = timeout(timeout_duration, child.wait_with_output()).await;

    match output_result {
        Ok(res) => {
            let mapped = res
                .map_err(|e| AppError::Generic(format!("Failed to run {} {:?}: {}", cmd, args, e)));
            if mapped.is_ok() {
                // The process already exited on its own and its output was
                // fully collected — nothing left to kill. Disarming here
                // also avoids ever calling kill_process_tree on a PID the OS
                // could since have reused for an unrelated process.
                guard.pid = None;
            }
            mapped
        }
        Err(_) => {
            // Timeout: leave `guard` armed. Its Drop (when this function
            // returns, right after this match) performs the actual
            // whole-tree kill (npm -> node -> the actual script).
            Err(AppError::Generic(format!(
                "Command timed out after {} seconds",
                timeout_duration.as_secs()
            )))
        }
    }
}

pub async fn run_command(
    cmd: &str,
    args: &[&str],
    cwd: &str,
    timeout_duration: Duration,
) -> Result<String, AppError> {
    let output = run_command_raw(cmd, args, cwd, timeout_duration).await?;

    if !output.status.success() {
        return Err(AppError::Generic(format!(
            "{} {:?} failed: {}",
            cmd,
            args,
            String::from_utf8_lossy(&output.stderr)
        )));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn run_command_raw_does_not_leak_secret_env_vars() {
        std::env::set_var("NPM_TOKEN", "leaked_if_this_test_fails");

        let cwd = std::env::temp_dir();
        let cwd_str = cwd.to_string_lossy().to_string();

        // Dump the whole environment visible to the spawned process rather than
        // relying on shell variable-expansion syntax (`%VAR%` / `$VAR`) in the
        // command argument: validate_shell_arg's allowlist now correctly rejects
        // `%` and `$` as injection/expansion vectors in their own right, so
        // those forms would fail validation before the process ever launched.
        #[cfg(windows)]
        let output = run_command_raw("cmd", &["/C", "set"], &cwd_str, Duration::from_secs(10))
            .await
            .unwrap();
        #[cfg(not(windows))]
        let output = run_command_raw("env", &[], &cwd_str, Duration::from_secs(10))
            .await
            .unwrap();

        let stdout = String::from_utf8_lossy(&output.stdout);
        // Guard against the leak check passing vacuously: if stdout capture
        // itself were ever silently broken (e.g. stdio defaulting to
        // inherited instead of piped), `stdout` would be empty and the
        // "doesn't contain the secret" assertion below would pass for the
        // wrong reason.
        assert!(
            !stdout.is_empty(),
            "expected the spawned process's stdout to be captured, got empty output"
        );
        assert!(
            !stdout.contains("leaked_if_this_test_fails"),
            "NPM_TOKEN must not be visible to spawned commands, got: {}",
            stdout
        );

        std::env::remove_var("NPM_TOKEN");
    }

    /// Confirms `run_command_raw`'s timeout branch actually kills the whole
    /// process *tree*, not just the direct child.
    ///
    /// A single-level child is NOT a valid test of this: `kill_on_drop(true)`
    /// (present before Task 14) already terminates a lone direct child when
    /// the future is dropped on timeout, so a test that only spawns one
    /// process can't tell "kill_process_tree walked the tree" apart from
    /// "kill_on_drop happened to kill the only process there was" — a
    /// regression that silently deleted the `kill_process_tree` call would
    /// still pass such a test.
    ///
    /// So this spawns a real two-level tree: the script `run_command_raw`
    /// launches (the direct child) itself launches a further detached
    /// process (the grandchild) that it does not wait on, records both PIDs
    /// to files, then sleeps long enough to be timed out. After the timeout
    /// fires we assert the GRANDCHILD is dead. `kill_on_drop` only reaches
    /// the direct child (a single `TerminateProcess`/`SIGKILL`); only
    /// `kill_process_tree`'s tree-walking kill (`taskkill /T` on Windows,
    /// process-group signal on Unix) reaches the grandchild, so this
    /// genuinely distinguishes the two.
    #[tokio::test]
    async fn run_command_raw_kills_grandchild_process_on_timeout() {
        fn process_is_alive(pid: u32) -> bool {
            #[cfg(windows)]
            {
                let output = std::process::Command::new("tasklist")
                    .args(["/FI", &format!("PID eq {}", pid), "/NH"])
                    .output()
                    .expect("tasklist should run");
                String::from_utf8_lossy(&output.stdout).contains(&pid.to_string())
            }
            #[cfg(not(windows))]
            {
                std::process::Command::new("kill")
                    .args(["-0", &pid.to_string()])
                    .status()
                    .map(|s| s.success())
                    .unwrap_or(false)
            }
        }

        let dir = std::env::temp_dir();
        let unique = format!("{}_{}", std::process::id(), uuid::Uuid::new_v4());
        let parent_pidfile = dir.join(format!("ppilot_timeout_kill_parent_{}.txt", unique));
        let grandchild_pidfile = dir.join(format!("ppilot_timeout_kill_grandchild_{}.txt", unique));

        #[cfg(windows)]
        let script_path = dir.join(format!("ppilot_timeout_kill_{}.ps1", unique));
        #[cfg(not(windows))]
        let script_path = dir.join(format!("ppilot_timeout_kill_{}.sh", unique));

        #[cfg(windows)]
        std::fs::write(
            &script_path,
            concat!(
                "param($ParentPidFile, $GrandchildPidFile)\n",
                "$PID | Out-File -FilePath $ParentPidFile -Encoding ascii\n",
                "$p = Start-Process -FilePath 'ping' -ArgumentList '-n','60','127.0.0.1' -WindowStyle Hidden -PassThru\n",
                "$p.Id | Out-File -FilePath $GrandchildPidFile -Encoding ascii\n",
                "Start-Sleep -Seconds 30\n",
            ),
        )
        .unwrap();
        #[cfg(not(windows))]
        {
            // `sleep 60 &` backgrounds a grandchild (relative to run_command_raw's
            // direct child, this `sh` process) that the script does not wait on;
            // `$!` captures its PID before the script's own long sleep begins.
            std::fs::write(
                &script_path,
                "#!/bin/sh\necho $$ > \"$1\"\nsleep 60 &\necho $! > \"$2\"\nsleep 30\n",
            )
            .unwrap();
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&script_path).unwrap().permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&script_path, perms).unwrap();
        }

        let script_name = script_path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();
        let parent_pidfile_name = parent_pidfile
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();
        let grandchild_pidfile_name = grandchild_pidfile
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();
        let cwd_str = dir.to_string_lossy().to_string();

        // Generous timeout: we only care that the process is killed once it
        // fires, not how tight the window is. The timeout must comfortably
        // exceed powershell.exe's cold-start plus launching the grandchild and
        // writing the pidfiles, otherwise on a slow/loaded CI runner the timeout
        // can fire mid-setup and kill powershell before it records the
        // grandchild's PID. The script sleeps 30s (grandchild pings for 60s), so
        // a 20s timeout still fires well before natural completion while leaving
        // a wide margin for setup.
        #[cfg(windows)]
        let result = run_command_raw(
            "powershell",
            &[
                "-NoProfile",
                "-NonInteractive",
                "-File",
                &script_name,
                &parent_pidfile_name,
                &grandchild_pidfile_name,
            ],
            &cwd_str,
            Duration::from_secs(20),
        )
        .await;
        #[cfg(not(windows))]
        let result = run_command_raw(
            "sh",
            &[&script_name, &parent_pidfile_name, &grandchild_pidfile_name],
            &cwd_str,
            Duration::from_secs(2),
        )
        .await;

        let err = result.expect_err("expected the long-sleeping command to time out");
        assert!(
            err.to_string().contains("timed out"),
            "expected a timeout error, got: {}",
            err
        );

        // Give the OS a moment to finish reaping the killed processes before we check.
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        let grandchild_pid_text = std::fs::read_to_string(&grandchild_pidfile).unwrap_or_else(|e| {
            panic!(
                "script should have written the grandchild's PID to {} before the timeout fired: {}",
                grandchild_pidfile.display(), e
            )
        });
        let grandchild_pid: u32 = grandchild_pid_text
            .trim()
            .parse()
            .expect("grandchild pidfile should contain a plain PID");

        assert!(
            !process_is_alive(grandchild_pid),
            "grandchild process {} should have been killed by run_command_raw's timeout branch \
             (via kill_process_tree walking the tree), but is still running — kill_on_drop alone \
             cannot reach it since it only terminates the direct child",
            grandchild_pid
        );

        let _ = std::fs::remove_file(&script_path);
        let _ = std::fs::remove_file(&parent_pidfile);
        let _ = std::fs::remove_file(&grandchild_pidfile);
    }
}
