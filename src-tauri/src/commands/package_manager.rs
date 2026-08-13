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
    } else if project_path.join("bun.lockb").exists() || project_path.join("bun.lock").exists() {
        let lock = if project_path.join("bun.lockb").exists() {
            "bun.lockb"
        } else {
            "bun.lock"
        };
        let version = get_version("bun").await;
        Ok(PackageManagerInfo {
            detected: PackageManager::Bun,
            version,
            lock_file: Some(lock.to_string()),
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

#[tauri::command(async)]
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
    let pm = crate::services::project::resolve_package_manager(std::path::Path::new(&path), None);
    let engine = crate::services::project::get_engine(pm);
    let cmd = match engine.pack_cmd() {
        crate::models::project::OperationSupport::Native(c) => c,
        crate::models::project::OperationSupport::Fallback { run, note } => {
            log::warn!("Pack fallback for {}: {}", path, note);
            run
        }
        crate::models::project::OperationSupport::Unsupported => {
            return Err(AppError::Generic(format!("Pack operation unsupported for {:?}", pm)));
        }
    };

    let mut args = cmd.args;
    args.push("--dry-run".to_string());

    let res = crate::services::shell::run_command(
        &cmd.program,
        &args.iter().map(|s| s.as_str()).collect::<Vec<&str>>(),
        &path,
        std::time::Duration::from_secs(60),
    )
    .await;

    res.map_err(|e| AppError::Generic(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};

    struct TestTempDir {
        path: PathBuf,
    }

    impl TestTempDir {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!("packagepilot_cmd_test_{}_{}", name, uuid::Uuid::new_v4()));
            let _ = fs::create_dir_all(&path);
            TestTempDir { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TestTempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[tokio::test]
    async fn test_detect_package_manager_bun_lockb() {
        let temp = TestTempDir::new("bun_lockb");
        fs::write(temp.path().join("bun.lockb"), "").unwrap();
        let info = detect_package_manager(temp.path().to_string_lossy().to_string()).await.unwrap();
        assert_eq!(info.detected, PackageManager::Bun);
        assert_eq!(info.lock_file.unwrap(), "bun.lockb");
    }

    #[tokio::test]
    async fn test_detect_package_manager_bun_lock() {
        let temp = TestTempDir::new("bun_lock");
        fs::write(temp.path().join("bun.lock"), "").unwrap();
        let info = detect_package_manager(temp.path().to_string_lossy().to_string()).await.unwrap();
        assert_eq!(info.detected, PackageManager::Bun);
        assert_eq!(info.lock_file.unwrap(), "bun.lock");
    }

    #[tokio::test]
    async fn test_detect_package_manager_pnpm() {
        let temp = TestTempDir::new("pnpm");
        fs::write(temp.path().join("pnpm-lock.yaml"), "").unwrap();
        let info = detect_package_manager(temp.path().to_string_lossy().to_string()).await.unwrap();
        assert_eq!(info.detected, PackageManager::Pnpm);
        assert_eq!(info.lock_file.unwrap(), "pnpm-lock.yaml");
    }

    #[tokio::test]
    async fn test_detect_package_manager_none() {
        let temp = TestTempDir::new("none");
        let info = detect_package_manager(temp.path().to_string_lossy().to_string()).await.unwrap();
        assert_eq!(info.detected, PackageManager::Unknown);
        assert!(info.lock_file.is_none());
    }
}

