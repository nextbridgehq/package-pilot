use crate::models::analytics::TaskExecution;
use crate::state::app_state::{AppState, LockExt};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct AnalyticsSummary {
    pub total_tasks_run: u32,
    pub total_duration_ms: u32,
}

#[tauri::command]
#[specta::specta]
pub async fn get_analytics_summary(
    state: tauri::State<'_, AppState>,
) -> Result<AnalyticsSummary, String> {
    let summary = {
        let store = state.analytics_store.lock_safe();
        let total_tasks_run = store.executions.len() as u32;
        let total_duration_ms = store.executions.iter().map(|e| e.duration_ms).sum();
        AnalyticsSummary {
            total_tasks_run,
            total_duration_ms,
        }
    };
    Ok(summary)
}

#[tauri::command]
#[specta::specta]
pub fn record_task_execution(
    script_name: String,
    duration_ms: u32,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut store = state.analytics_store.lock_safe();
    store.executions.push(TaskExecution {
        id: uuid::Uuid::new_v4().to_string(),
        project_id: "local-project".to_string(),
        script_name,
        duration_ms,
        timestamp: chrono::Utc::now().to_rfc3339(),
    });
    Ok(())
}
