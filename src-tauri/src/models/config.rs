use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default, specta::Type)]
pub struct AppConfig {
    pub general: GeneralConfig,
    pub watcher: WatcherConfig,
    pub appearance: AppearanceConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct GeneralConfig {
    pub default_package_manager: String,
    pub auto_build_on_link: bool,
    pub auto_install_deps: bool,
    pub projects_directory: Option<String>,
    /// SECURITY: when false (default), every link/install command runs with
    /// `--ignore-scripts` so a linked package's postinstall/prepare/prepack
    /// scripts never execute. See services/link.rs.
    #[serde(default)]
    pub allow_lifecycle_scripts: bool,
}

impl Default for GeneralConfig {
    fn default() -> Self {
        Self {
            default_package_manager: "npm".to_string(),
            auto_build_on_link: true,
            auto_install_deps: true,
            projects_directory: None,
            allow_lifecycle_scripts: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct WatcherConfig {
    pub debounce_ms: u32,
    pub ignore_patterns: Vec<String>,
    pub auto_rebuild: bool,
}

impl Default for WatcherConfig {
    fn default() -> Self {
        Self {
            debounce_ms: 500,
            ignore_patterns: vec![
                "node_modules".to_string(),
                ".git".to_string(),
                "dist".to_string(),
                "*.log".to_string(),
            ],
            auto_rebuild: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct AppearanceConfig {
    pub theme: String,
    pub sidebar_collapsed: bool,
}

impl Default for AppearanceConfig {
    fn default() -> Self {
        Self {
            theme: "system".to_string(),
            sidebar_collapsed: false,
        }
    }
}
