pub fn process_is_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }
    #[cfg(windows)]
    {
        if let Ok(output) = std::process::Command::new("tasklist")
            .args(["/FI", &format!("PID eq {}", pid)])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            stdout.contains(&pid.to_string())
        } else {
            false
        }
    }
}

/// Attempt to terminate `pid` and its entire process tree.
///
/// On Unix this assumes the process was spawned into its own process group
/// (see `command_in_new_group`) and signals the whole group: SIGTERM first,
/// then — after a short grace period — SIGKILL for anything still alive.
/// On Windows, `taskkill /T /F` walks and kills the tree directly.
pub fn kill_process_tree(pid: u32) -> Result<(), String> {
    #[cfg(unix)]
    {
        unsafe {
            libc::kill(-(pid as i32), libc::SIGTERM);
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
        unsafe {
            libc::kill(-(pid as i32), libc::SIGKILL);
        }
        Ok(())
    }

    #[cfg(windows)]
    {
        let output = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output()
            .map_err(|e| format!("Failed to run taskkill: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // "not found" means the process already exited — not an error for our purposes.
            if !stderr.contains("not found") {
                return Err(format!("taskkill failed: {}", stderr));
            }
        }
        Ok(())
    }
}

/// Configure a `tokio::process::Command` to run in its own process group
/// (Unix) or process-group-creation mode (Windows), so `kill_process_tree`
/// can later reach every descendant, not just the direct child.
#[cfg(unix)]
pub fn command_in_new_group(cmd: &mut tokio::process::Command) {
    use std::os::unix::process::CommandExt;
    unsafe {
        cmd.pre_exec(|| {
            if libc::setpgid(0, 0) != 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
}

#[cfg(windows)]
pub fn command_in_new_group(cmd: &mut tokio::process::Command) {
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
    cmd.creation_flags(CREATE_NEW_PROCESS_GROUP);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[tokio::test]
    async fn kill_process_tree_terminates_a_grouped_child() {
        let mut cmd = tokio::process::Command::new("sleep");
        cmd.arg("30");
        command_in_new_group(&mut cmd);
        let mut child = cmd.spawn().unwrap();
        let pid = child.id().unwrap();

        kill_process_tree(pid).unwrap();

        // give the OS a moment to reap the signaled process
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        let status = child.try_wait().unwrap();
        assert!(
            status.is_some(),
            "process should have exited after kill_process_tree"
        );
    }

    // Note: the task brief's reference implementation used `timeout /T 30` here.
    // In this environment `timeout.exe` detects that stdin is not an attached
    // console (as happens under `cargo test`) and immediately prints
    // "ERROR: Input redirection is not supported, exiting the process
    // immediately." and exits within ~50ms — before `kill_process_tree` ever
    // runs. That made the assertion pass vacuously (the child died on its
    // own, not because of the kill). `ping -n 31 127.0.0.1` runs for ~30s
    // unconditionally, is unaffected by stdin redirection, and was verified
    // separately (via a temporary probe test) to still be alive after 1s+ of
    // polling when `kill_process_tree` is never called — confirming this test
    // genuinely exercises the kill path.
    #[cfg(windows)]
    #[tokio::test]
    async fn kill_process_tree_terminates_a_grouped_child() {
        let mut cmd = tokio::process::Command::new("ping");
        cmd.args(["-n", "31", "127.0.0.1"]);
        command_in_new_group(&mut cmd);
        let mut child = cmd.spawn().unwrap();
        let pid = child.id().unwrap();

        // Confirm the process is genuinely alive before we attempt to kill it.
        assert!(
            child.try_wait().unwrap().is_none(),
            "process should still be running before kill_process_tree"
        );

        kill_process_tree(pid).unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        let status = child.try_wait().unwrap();
        assert!(
            status.is_some(),
            "process should have exited after kill_process_tree"
        );
    }
}
