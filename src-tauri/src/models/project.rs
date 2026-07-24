use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

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
    pub created_at: DateTime<Utc>,
    pub last_accessed: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, specta::Type)]
pub enum PackageManager {
    Npm,
    Yarn,
    Pnpm,
    Unknown,
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
