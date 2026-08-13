use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, specta::Type, Default)]
pub enum WorkspaceTool {
    Turbo,
    Lerna,
    Pnpm,
    Yarn,
    Npm,
    #[default]
    None
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub package_manager: PackageManager,
    pub packages: Vec<PackageInfo>,
    #[serde(default)]
    pub ignored_packages: Vec<String>,
    #[serde(default)]
    pub only_cli: bool,
    #[serde(default)]
    pub workspace_tool: WorkspaceTool,
    pub created_at: DateTime<Utc>,
    pub last_accessed: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, specta::Type)]
pub enum PackageManager {
    Npm,
    Yarn,
    Pnpm,
    Bun,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub enum OperationSupport<T> {
    Native(T),
    Fallback { run: T, note: String },
    Unsupported,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct PmCommand {
    pub program: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct InstallOptions {
    pub target_tarball: Option<String>,
    pub ignore_scripts: bool,
    pub no_save: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct PackageInfo {
    pub name: String,
    pub version: String,
    pub path: String,
    pub is_private: bool,
    pub dependencies: Vec<Dependency>,
    pub dev_dependencies: Vec<Dependency>,
    pub peer_dependencies: Vec<Dependency>,
    #[serde(default)]
    pub has_cli: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct Dependency {
    pub name: String,
    pub version: String,
    pub is_local: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_package_manager_bun_serialization() {
        let pm = PackageManager::Bun;
        let json = serde_json::to_string(&pm).unwrap();
        assert_eq!(json, "\"Bun\"");
    }

    #[test]
    fn test_operation_support_fallback() {
        let support = OperationSupport::Fallback {
            run: PmCommand {
                program: "npm".to_string(),
                args: vec!["pack".to_string()],
            },
            note: "test note".to_string(),
        };
        if let OperationSupport::Fallback { run, note } = support {
            assert_eq!(run.program, "npm");
            assert_eq!(note, "test note");
        } else {
            panic!("Expected Fallback variant");
        }
    }
}

