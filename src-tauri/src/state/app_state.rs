use crate::models::{config::AppConfig, link::LinkEntry, project::Project};
use portable_pty::{Child, MasterPty};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

pub trait LockExt<T> {
    /// Locks the mutex, recovering the inner value if a prior panic poisoned it
    /// instead of propagating the poison and panicking here too.
    fn lock_safe(&self) -> std::sync::MutexGuard<'_, T>;
}

impl<T> LockExt<T> for Mutex<T> {
    fn lock_safe(&self) -> std::sync::MutexGuard<'_, T> {
        self.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct PersistentState {
    pub version: u32,
    pub projects: Vec<Project>,
    pub active_links: Vec<LinkEntry>,
    pub config: Option<AppConfig>,
    #[serde(default)]
    pub logs: Vec<LogEntry>,
}

impl Default for PersistentState {
    fn default() -> Self {
        Self {
            version: 1,
            projects: Vec::new(),
            active_links: Vec::new(),
            config: Some(AppConfig::default()),
            logs: Vec::new(),
        }
    }
}

pub struct AppState {
    pub persistent: Mutex<PersistentState>,
    pub watchers: Mutex<HashMap<String, std::sync::Arc<std::sync::atomic::AtomicBool>>>,
    pub registry_running: Mutex<bool>,
    pub data_dir: Mutex<Option<PathBuf>>,
    pub dirty: std::sync::Arc<std::sync::atomic::AtomicBool>,
    pub app_handle: Mutex<Option<AppHandle>>,
    pub analytics_store: Mutex<crate::models::analytics::AnalyticsStore>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct LogEntry {
    pub id: String,
    pub timestamp: String,
    pub level: LogLevel,
    pub message: String,
    pub source: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
#[allow(dead_code)]
pub enum LogLevel {
    Info,
    Warning,
    Error,
    Success,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            persistent: Mutex::new(PersistentState::default()),
            watchers: Mutex::new(HashMap::new()),
            registry_running: Mutex::new(false),
            data_dir: Mutex::new(None),
            dirty: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            app_handle: Mutex::new(None),
            analytics_store: Mutex::new(crate::models::analytics::AnalyticsStore::default()),
        }
    }

    pub fn load(&self, data_dir_param: &Path) {
        let state_path = data_dir_param.join("state.json");
        if let Ok(content) = std::fs::read_to_string(&state_path) {
            if let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&content) {
                let version = value.get("version").and_then(|v| v.as_u64()).unwrap_or(0);

                if version < 1 {
                    if let Some(obj) = value.as_object_mut() {
                        obj.insert("version".to_string(), serde_json::json!(1));
                    }
                }

                if let Ok(data) = serde_json::from_value::<PersistentState>(value) {
                    *self.persistent.lock_safe() = data;
                } else {
                    log::warn!("Failed to deserialize state data.");
                }
            }
        }
        *self.data_dir.lock_safe() = Some(data_dir_param.to_path_buf());
    }

    pub fn save(&self) {
        self.dirty.store(true, std::sync::atomic::Ordering::SeqCst);
    }

    pub fn force_save(&self) {
        let dir = {
            self.data_dir.lock_safe().clone()
        };
        if let Some(dir) = dir {
            if !dir.exists() {
                let _ = std::fs::create_dir_all(&dir);
            }

            let data = self.persistent.lock_safe().clone();

            if let Ok(content) = serde_json::to_string_pretty(&data) {
                let state_path = dir.join("state.json");
                let tmp_path = dir.join("state.json.tmp");
                if std::fs::write(&tmp_path, &content).is_ok() {
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        let _ = std::fs::set_permissions(
                            &tmp_path,
                            std::fs::Permissions::from_mode(0o600),
                        );
                    }
                    let _ = std::fs::rename(&tmp_path, &state_path);
                }
            }
        }
    }

    pub fn add_log(&self, level: LogLevel, message: String, source: String) {
        let level_str = match level {
            LogLevel::Info => "info",
            LogLevel::Warning => "warning",
            LogLevel::Error => "error",
            LogLevel::Success => "success",
        };
        let entry = LogEntry {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            level,
            message,
            source,
        };

        if let Some(handle) = self.app_handle.lock_safe().as_ref() {
            let _ = handle.emit(
                "log-entry",
                serde_json::json!({
                    "id": entry.id,
                    "timestamp": entry.timestamp,
                    "level": level_str,
                    "message": entry.message,
                    "source": entry.source,
                }),
            );
        }

        let mut persistent = self.persistent.lock_safe();
        persistent.logs.push(entry);
        if persistent.logs.len() > 1000 {
            persistent.logs.remove(0);
        }
        drop(persistent);
        self.save();
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

pub struct PtySession {
    /// `Option` so teardown can close these before joining the reader thread.
    /// The reader parks in a blocking read on the master and only unblocks once
    /// every handle to it is gone.
    pub master: Option<Box<dyn MasterPty + Send>>,
    pub child: Box<dyn Child + Send + Sync>,
    pub writer: Option<Box<dyn std::io::Write + Send>>,
    pub directory: String,
    pub history: std::sync::Arc<std::sync::Mutex<String>>,
    pub cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
    pub reader_thread: Option<std::thread::JoinHandle<()>>,
}

impl Drop for PtySession {
    fn drop(&mut self) {
        self.cancel.store(true, std::sync::atomic::Ordering::SeqCst);
        // Use kill_process_tree to ensure grandchild processes (like `npm run build` scripts)
        // are properly terminated rather than orphaned as zombies.
        if let Some(pid) = self.child.process_id() {
            let _ = crate::utils::process::kill_process_tree(pid);
        } else {
            let _ = self.child.kill();
        }

        // Close every handle to the PTY before joining. The reader thread is
        // blocked inside `read()` on the master and will not observe `cancel`
        // until that read returns - which it only does once the master is
        // closed. Joining first can hang forever.
        drop(self.writer.take());
        drop(self.master.take());

        if let Some(thread) = self.reader_thread.take() {
            let _ = thread.join();
        }
    }
}

pub struct PtyState {
    pub sessions: Mutex<HashMap<String, PtySession>>,
}

impl PtyState {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for PtyState {
    fn default() -> Self {
        Self::new()
    }
}

pub struct RegistryState {
    pub process_id: Mutex<Option<u32>>,
}

impl RegistryState {
    pub fn new() -> Self {
        Self {
            process_id: Mutex::new(None),
        }
    }
}

impl Default for RegistryState {
    fn default() -> Self {
        Self::new()
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "pp_app_state_test_{}_{}",
            name,
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn logs_survive_a_save_and_load_round_trip() {
        let dir = temp_dir("logs_round_trip");

        let state = AppState::new();
        *state.data_dir.lock_safe() = Some(dir.clone());
        state.add_log(
            LogLevel::Success,
            "first entry".to_string(),
            "Test".to_string(),
        );
        state.add_log(
            LogLevel::Error,
            "second entry".to_string(),
            "Test".to_string(),
        );
        state.force_save();

        let reloaded = AppState::new();
        reloaded.load(&dir);

        let persistent = reloaded.persistent.lock_safe();
        let logs = &persistent.logs;
        assert_eq!(logs.len(), 2);
        assert_eq!(logs[0].message, "first entry");
        assert_eq!(logs[1].message, "second entry");
        drop(persistent);

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn load_defaults_logs_to_empty_when_state_json_predates_the_field() {
        // A state.json written before logs were persisted has no "logs" key
        // at all - #[serde(default)] must make this load cleanly rather than
        // fail deserialization and silently drop projects/links/config too.
        let dir = temp_dir("logs_missing_field");
        let state_path = dir.join("state.json");
        std::fs::write(
            &state_path,
            r#"{"version":1,"projects":[],"active_links":[],"config":null}"#,
        )
        .unwrap();

        let state = AppState::new();
        state.load(&dir);

        assert!(state.persistent.lock_safe().logs.is_empty());

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
