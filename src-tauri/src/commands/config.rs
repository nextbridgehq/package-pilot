use crate::models::config::AppConfig;
use crate::state::app_state::{AppState, LockExt};
use tauri::State;

#[tauri::command]
#[specta::specta]

pub fn get_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    Ok(state
        .persistent
        .lock_safe()
        .config
        .clone()
        .unwrap_or_default())
}

#[tauri::command]
#[specta::specta]

pub fn save_config(config: AppConfig, state: State<'_, AppState>) -> Result<(), String> {
    state.persistent.lock_safe().config = Some(config);
    state.save();
    Ok(())
}
