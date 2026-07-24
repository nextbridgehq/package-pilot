use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct LinkEntry {
    pub id: String,
    pub source_package: String,
    pub source_path: String,
    pub target_project: String,
    pub target_path: String,
    pub method: LinkMethod,
    pub status: LinkStatus,
    pub watch_enabled: bool,
    pub created_at: DateTime<Utc>,
    pub last_synced: Option<DateTime<Utc>>,
    #[serde(default)]
    pub has_cli: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, specta::Type)]
pub enum LinkMethod {
    Symlink,
    NpmPack,
    Yalc,
    Workspace,
    FileCopy,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, specta::Type)]
pub enum LinkStatus {
    Active,
    Broken,
    Syncing,
    Error(String),
    Inactive,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct LinkRequest {
    pub source_path: String,
    pub target_path: String,
    pub method: LinkMethod,
    pub watch: bool,
    pub build_first: bool,
    pub install_peer_deps: bool,
    #[serde(default)]
    pub allow_lifecycle_scripts: bool,
}
