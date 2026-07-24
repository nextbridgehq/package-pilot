pub mod build;
pub mod config;
pub mod doctor;
pub mod link;
pub mod logs;
pub mod package_manager;
pub mod project;
pub mod pty;
pub mod watcher;

use crate::state::app_state::LockExt;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
#[specta::specta]

pub async fn open_folder_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let folder = tokio::task::spawn_blocking(move || app.dialog().file().blocking_pick_folder())
        .await
        .map_err(|e| e.to_string())?;

    Ok(folder.map(|f| f.to_string()))
}

#[tauri::command]
#[specta::specta]

pub fn open_terminal(
    path: String,
    state: tauri::State<'_, crate::state::app_state::AppState>,
) -> Result<(), String> {
    crate::utils::validation::validate_shell_arg(&path).map_err(|e| e.to_string())?;

    // Verify path is under a known project or sandbox
    let canonical = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
    let persistent = state.persistent.lock_safe();
    let is_allowed = {
        let sandbox_base = std::env::temp_dir().join("PackagePilot_Sandboxes");
        let is_sandbox = std::fs::canonicalize(&sandbox_base)
            .map(|base| canonical.starts_with(&base))
            .unwrap_or(false);
        is_sandbox
            || persistent.projects.iter().any(|p| {
                std::fs::canonicalize(&p.path)
                    .map(|cp| canonical.starts_with(&cp))
                    .unwrap_or(false)
            })
    };
    if !is_allowed {
        return Err("Path must be within a registered project or sandbox".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let mut cmd = std::process::Command::new("cmd");
        cmd.args([
            "/c",
            "start",
            "powershell",
            "-NoExit",
            "-Command",
            &format!("cd '{}'", path),
        ]);
        cmd.env_clear();
        cmd.envs(crate::utils::env_filter::sanitized_env());
        cmd.spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]

pub fn open_in_explorer(
    path: String,
    state: tauri::State<'_, crate::state::app_state::AppState>,
) -> Result<(), String> {
    crate::utils::validation::validate_shell_arg(&path).map_err(|e| e.to_string())?;

    // Verify path is under a known project or sandbox
    let canonical = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
    let persistent = state.persistent.lock_safe();
    let is_allowed = {
        let sandbox_base = std::env::temp_dir().join("PackagePilot_Sandboxes");
        let is_sandbox = std::fs::canonicalize(&sandbox_base)
            .map(|base| canonical.starts_with(&base))
            .unwrap_or(false);
        is_sandbox
            || persistent.projects.iter().any(|p| {
                std::fs::canonicalize(&p.path)
                    .map(|cp| canonical.starts_with(&cp))
                    .unwrap_or(false)
            })
            || persistent.active_links.iter().any(|l| {
                std::fs::canonicalize(&l.target_path)
                    .map(|cp| canonical.starts_with(&cp))
                    .unwrap_or(false)
            })
    };
    if !is_allowed {
        return Err("Path must be within a registered project or sandbox".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn quit_app(app_handle: tauri::AppHandle) {
    use tauri::Manager;
    let state = app_handle.state::<crate::state::app_state::AppState>();
    if state.dirty.load(std::sync::atomic::Ordering::SeqCst) {
        state.force_save();
    }
    // Graceful shutdown via the event loop: fires RunEvent::ExitRequested and
    // runs managed-state destructors (PtySession::drop kills PTY children)
    // before the process terminates. A hard std::process::exit(0) skips both,
    // orphaning PTY children and leaving WebView2 to log the benign but noisy
    // "Failed to unregister class Chrome_WidgetWin_0" (error 1412) on the way out.
    app_handle.exit(0);
}

#[tauri::command]
#[specta::specta]

pub fn get_system_info() -> Result<SystemInfo, String> {
    Ok(SystemInfo {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        node_version: get_command_output("node", &["--version"]).unwrap_or_default(),
        npm_version: get_command_output("npm", &["--version"]).unwrap_or_default(),
        yarn_version: get_command_output("yarn", &["--version"]).ok(),
        pnpm_version: get_command_output("pnpm", &["--version"]).ok(),
    })
}

#[tauri::command]
#[specta::specta]

pub fn get_filtered_env_vars() -> Vec<String> {
    crate::utils::env_filter::filtered_variable_names()
}

#[derive(serde::Serialize, specta::Type)]
pub struct SystemInfo {
    pub os: String,
    pub arch: String,
    pub node_version: String,
    pub npm_version: String,
    pub yarn_version: Option<String>,
    pub pnpm_version: Option<String>,
}

pub fn cmd_name(name: &str) -> String {
    if let Ok(path) = which::which(name) {
        return path.to_string_lossy().to_string();
    }

    if cfg!(target_os = "windows") && ["npm", "yarn", "pnpm", "yalc", "npx"].contains(&name) {
        return format!("{}.cmd", name);
    }
    name.to_string()
}

fn get_command_output(cmd: &str, args: &[&str]) -> Result<String, String> {
    crate::utils::validation::validate_shell_arg(cmd).map_err(|e| e.to_string())?;
    for arg in args {
        crate::utils::validation::validate_shell_arg(arg).map_err(|e| e.to_string())?;
    }
    std::process::Command::new(cmd_name(cmd))
        .args(args)
        .output()
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .map_err(|e| e.to_string())
}
