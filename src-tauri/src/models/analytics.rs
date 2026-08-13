use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct TaskExecution {
    pub id: String,
    pub project_id: String,
    pub script_name: String,
    pub duration_ms: u32,
    pub timestamp: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AnalyticsStore {
    pub executions: Vec<TaskExecution>,
}
