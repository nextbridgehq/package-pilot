use crate::error::AppError;
use crate::models::project::PackageManager;
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize, specta::Type)]
pub struct PackageManagerInfo {
    pub detected: PackageManager,
    pub version: Option<String>,
    pub lock_file: Option<String>,
}

#[tauri::command]
#[specta::specta]

pub async fn detect_package_manager(path: String) -> Result<PackageManagerInfo, AppError> {
    let project_path = Path::new(&path);

    if project_path.join("pnpm-lock.yaml").exists() {
        let version = get_version("pnpm").await;
        Ok(PackageManagerInfo {
            detected: PackageManager::Pnpm,
            version,
            lock_file: Some("pnpm-lock.yaml".to_string()),
        })
    } else if project_path.join("yarn.lock").exists() {
        let version = get_version("yarn").await;
        Ok(PackageManagerInfo {
            detected: PackageManager::Yarn,
            version,
            lock_file: Some("yarn.lock".to_string()),
        })
    } else if project_path.join("package-lock.json").exists() {
        let version = get_version("npm").await;
        Ok(PackageManagerInfo {
            detected: PackageManager::Npm,
            version,
            lock_file: Some("package-lock.json".to_string()),
        })
    } else {
        Ok(PackageManagerInfo {
            detected: PackageManager::Unknown,
            version: None,
            lock_file: None,
        })
    }
}

#[tauri::command]
#[specta::specta]

pub fn get_package_info(path: String) -> Result<String, AppError> {
    let pkg_json_path = Path::new(&path).join("package.json");
    let content = std::fs::read_to_string(&pkg_json_path)
        .map_err(|e| AppError::Generic(format!("Cannot read package.json: {}", e)))?;
    let pkg: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| AppError::Generic(format!("Cannot parse package.json: {}", e)))?;
    Ok(pkg.to_string())
}

async fn get_version(cmd: &str) -> Option<String> {
    crate::utils::validation::validate_shell_arg(cmd).ok()?;
    tokio::process::Command::new(crate::commands::cmd_name(cmd))
        .arg("--version")
        .output()
        .await
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
}

#[tauri::command]
#[specta::specta]

pub async fn npm_pack_dry_run(path: String) -> Result<String, AppError> {
    let res = crate::services::shell::run_command(
        "npm",
        &["pack", "--dry-run"],
        &path,
        std::time::Duration::from_secs(60),
    )
    .await;

    res.map_err(|e| AppError::Generic(e.to_string()))
}
