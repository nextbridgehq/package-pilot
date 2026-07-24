use crate::commands::cmd_name;
use serde::Serialize;

#[derive(Debug, Serialize, specta::Type)]
pub struct DiagnosticResult {
    pub category: String,
    pub check: String,
    pub status: DiagnosticStatus,
    pub message: String,
    pub fix_suggestion: Option<String>,
    pub fix_command: Option<String>,
}

#[derive(Debug, Serialize, specta::Type)]
pub enum DiagnosticStatus {
    Pass,
    Warning,
    Fail,
}

#[tauri::command]
#[specta::specta]

pub async fn run_diagnostics() -> Result<Vec<DiagnosticResult>, String> {
    let results = vec![
        check_node(),
        check_npm(),
        check_yarn(),
        check_pnpm(),
        check_yalc(),
        check_symlink_perms(),
        check_developer_mode(),
    ];

    Ok(results)
}

#[tauri::command]
#[specta::specta]

pub fn check_symlink_permissions() -> Result<DiagnosticResult, String> {
    Ok(check_symlink_perms())
}

#[tauri::command]
#[specta::specta]

pub fn check_node_installation() -> Result<DiagnosticResult, String> {
    Ok(check_node())
}

fn check_node() -> DiagnosticResult {
    match std::process::Command::new(cmd_name("node"))
        .arg("--version")
        .output()
    {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            DiagnosticResult {
                category: "Runtime".to_string(),
                check: "Node.js Installation".to_string(),
                status: DiagnosticStatus::Pass,
                message: format!("Node.js {} is installed", version),
                fix_suggestion: None,
                fix_command: None,
            }
        }
        _ => DiagnosticResult {
            category: "Runtime".to_string(),
            check: "Node.js Installation".to_string(),
            status: DiagnosticStatus::Fail,
            message: "Node.js is not installed or not in PATH".to_string(),
            fix_suggestion: Some("Install Node.js from https://nodejs.org".to_string()),
            fix_command: None,
        },
    }
}

fn check_npm() -> DiagnosticResult {
    match std::process::Command::new(cmd_name("npm"))
        .arg("--version")
        .output()
    {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            DiagnosticResult {
                category: "Package Manager".to_string(),
                check: "npm Installation".to_string(),
                status: DiagnosticStatus::Pass,
                message: format!("npm v{} is installed", version),
                fix_suggestion: None,
                fix_command: None,
            }
        }
        _ => DiagnosticResult {
            category: "Package Manager".to_string(),
            check: "npm Installation".to_string(),
            status: DiagnosticStatus::Fail,
            message: "npm is not installed".to_string(),
            fix_suggestion: Some("npm comes with Node.js. Reinstall Node.js".to_string()),
            fix_command: None,
        },
    }
}

fn check_yarn() -> DiagnosticResult {
    match std::process::Command::new(cmd_name("yarn"))
        .arg("--version")
        .output()
    {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            DiagnosticResult {
                category: "Package Manager".to_string(),
                check: "Yarn Installation".to_string(),
                status: DiagnosticStatus::Pass,
                message: format!("Yarn v{} is installed", version),
                fix_suggestion: None,
                fix_command: None,
            }
        }
        _ => DiagnosticResult {
            category: "Package Manager".to_string(),
            check: "Yarn Installation".to_string(),
            status: DiagnosticStatus::Warning,
            message: "Yarn is not installed (optional)".to_string(),
            fix_suggestion: Some("Run: npm install -g yarn".to_string()),
            fix_command: Some("npm install -g yarn".to_string()),
        },
    }
}

fn check_pnpm() -> DiagnosticResult {
    match std::process::Command::new(cmd_name("pnpm"))
        .arg("--version")
        .output()
    {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            DiagnosticResult {
                category: "Package Manager".to_string(),
                check: "pnpm Installation".to_string(),
                status: DiagnosticStatus::Pass,
                message: format!("pnpm v{} is installed", version),
                fix_suggestion: None,
                fix_command: None,
            }
        }
        _ => DiagnosticResult {
            category: "Package Manager".to_string(),
            check: "pnpm Installation".to_string(),
            status: DiagnosticStatus::Warning,
            message: "pnpm is not installed (optional)".to_string(),
            fix_suggestion: Some("Run: npm install -g pnpm".to_string()),
            fix_command: Some("npm install -g pnpm".to_string()),
        },
    }
}

fn check_yalc() -> DiagnosticResult {
    match std::process::Command::new(cmd_name("yalc"))
        .arg("--version")
        .output()
    {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            DiagnosticResult {
                category: "Tools".to_string(),
                check: "Yalc Installation".to_string(),
                status: DiagnosticStatus::Pass,
                message: format!("Yalc v{} is installed", version),
                fix_suggestion: None,
                fix_command: None,
            }
        }
        _ => DiagnosticResult {
            category: "Tools".to_string(),
            check: "Yalc Installation".to_string(),
            status: DiagnosticStatus::Warning,
            message: "Yalc is not installed (recommended for local testing)".to_string(),
            fix_suggestion: Some("Run: npm install -g yalc".to_string()),
            fix_command: Some("npm install -g yalc".to_string()),
        },
    }
}

fn check_symlink_perms() -> DiagnosticResult {
    #[cfg(target_os = "windows")]
    {
        let temp_dir = std::env::temp_dir();
        let test_target = temp_dir.join("_pp_symlink_test_target");
        let test_link = temp_dir.join("_pp_symlink_test_link");

        let _ = std::fs::write(&test_target, "test");
        let result = std::os::windows::fs::symlink_file(&test_target, &test_link);
        let _ = std::fs::remove_file(&test_target);
        let _ = std::fs::remove_file(&test_link);

        match result {
            Ok(_) => DiagnosticResult {
                category: "System".to_string(),
                check: "Symlink Permissions".to_string(),
                status: DiagnosticStatus::Pass,
                message: "Symlink creation is allowed".to_string(),
                fix_suggestion: None,
                fix_command: None,
            },
            Err(_) => DiagnosticResult {
                category: "System".to_string(),
                check: "Symlink Permissions".to_string(),
                status: DiagnosticStatus::Fail,
                message: "Cannot create symlinks. Developer Mode may be required".to_string(),
                fix_suggestion: Some(
                    "Enable Developer Mode: Settings > Update & Security > For Developers, or run as Administrator".to_string()
                ),
                fix_command: Some("start ms-settings:developers".to_string()),
            },
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        DiagnosticResult {
            category: "System".to_string(),
            check: "Symlink Permissions".to_string(),
            status: DiagnosticStatus::Pass,
            message: "Symlinks are natively supported on this OS".to_string(),
            fix_suggestion: None,
            fix_command: None,
        }
    }
}

fn check_developer_mode() -> DiagnosticResult {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let is_dev_mode = || -> bool {
            let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
            if let Ok(key) =
                hklm.open_subkey("SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppModelUnlock")
            {
                if let Ok(val) = key.get_value::<u32, _>("AllowDevelopmentWithoutDevLicense") {
                    return val == 1;
                }
            }
            false
        }();

        if is_dev_mode {
            DiagnosticResult {
                category: "System".to_string(),
                check: "Windows Developer Mode".to_string(),
                status: DiagnosticStatus::Pass,
                message: "Developer Mode is enabled".to_string(),
                fix_suggestion: None,
                fix_command: None,
            }
        } else {
            DiagnosticResult {
                category: "System".to_string(),
                check: "Windows Developer Mode".to_string(),
                status: DiagnosticStatus::Warning,
                message: "Developer Mode is not enabled".to_string(),
                fix_suggestion: Some(
                    "Enable in Settings > Update & Security > For Developers".to_string(),
                ),
                fix_command: Some("start ms-settings:developers".to_string()),
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        DiagnosticResult {
            category: "System".to_string(),
            check: "Developer Mode".to_string(),
            status: DiagnosticStatus::Pass,
            message: "Developer Mode is not required on this OS".to_string(),
            fix_suggestion: None,
            fix_command: None,
        }
    }
}

#[tauri::command]
#[specta::specta]

pub async fn export_diagnostics(
    state: tauri::State<'_, crate::state::app_state::AppState>,
) -> Result<String, String> {
    use crate::state::app_state::LockExt;

    let mut data = serde_json::Map::new();
    let persistent = state.persistent.lock_safe();

    data.insert("version".to_string(), serde_json::json!(persistent.version));
    data.insert(
        "project_count".to_string(),
        serde_json::json!(persistent.projects.len()),
    );
    data.insert(
        "link_count".to_string(),
        serde_json::json!(persistent.active_links.len()),
    );
    data.insert("logs".to_string(), serde_json::json!(persistent.logs));

    let sys_info = std::env::consts::OS.to_string();
    data.insert("system_info".to_string(), serde_json::json!(sys_info));

    serde_json::to_string_pretty(&data).map_err(|e| e.to_string())
}
