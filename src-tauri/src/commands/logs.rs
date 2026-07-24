use crate::state::app_state::{AppState, LockExt, LogEntry};
use tauri::State;

#[tauri::command]
#[specta::specta]

pub fn get_logs(state: State<'_, AppState>) -> Vec<LogEntry> {
    state.persistent.lock_safe().logs.clone()
}

#[tauri::command]
#[specta::specta]

pub fn clear_logs(state: State<'_, AppState>) {
    state.persistent.lock_safe().logs.clear();
    state.save();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::app_state::LogLevel;

    #[test]
    fn get_logs_returns_entries_in_the_order_they_were_added() {
        let state = AppState::new();
        state.add_log(LogLevel::Info, "one".to_string(), "Test".to_string());
        state.add_log(LogLevel::Info, "two".to_string(), "Test".to_string());

        let persistent = state.persistent.lock_safe();
        let logs = &persistent.logs;
        assert_eq!(logs.len(), 2);
        assert_eq!(logs[0].message, "one");
        assert_eq!(logs[1].message, "two");
    }

    #[test]
    fn get_logs_serializes_level_as_lowercase_matching_the_live_event_path() {
        // add_log's live "log-entry" event manually lowercases the level
        // (see app_state.rs's `level_str` match). get_logs instead relies on
        // LogEntry's derived Serialize for its whole Vec<LogEntry> return
        // value - without #[serde(rename_all = "lowercase")] on LogLevel,
        // that derive would emit "Info"/"Warning"/etc. (Rust's default
        // PascalCase), silently disagreeing with both the live-event path
        // and the frontend's LogEntry["level"] union type ("info" | ...).
        let state = AppState::new();
        state.add_log(LogLevel::Success, "ok".to_string(), "Test".to_string());
        state.add_log(LogLevel::Warning, "hmm".to_string(), "Test".to_string());
        state.add_log(LogLevel::Error, "bad".to_string(), "Test".to_string());
        state.add_log(LogLevel::Info, "fyi".to_string(), "Test".to_string());

        let persistent = state.persistent.lock_safe();
        let json = serde_json::to_value(&persistent.logs).unwrap();
        let levels: Vec<&str> = json
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| entry["level"].as_str().unwrap())
            .collect();

        assert_eq!(levels, vec!["success", "warning", "error", "info"]);
    }

    #[test]
    fn clear_logs_empties_the_backend_store() {
        let state = AppState::new();
        state.add_log(
            LogLevel::Info,
            "will be cleared".to_string(),
            "Test".to_string(),
        );
        assert_eq!(state.persistent.lock_safe().logs.len(), 1);

        state.persistent.lock_safe().logs.clear();
        state.save();

        assert!(state.persistent.lock_safe().logs.is_empty());
    }
}
