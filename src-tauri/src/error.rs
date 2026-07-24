use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error, specta::Type)]
#[specta(type = String)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Command execution failed: {0}")]
    Command(String),
    #[error("State lock poisoned: {0}")]
    LockPoisoned(String),
    #[error("Invalid path: {0}")]
    InvalidPath(String),
    #[error("Invalid package name: {0}")]
    InvalidPackageName(String),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Generic(String),
}

// We must manually implement Serialize so Tauri can pass it back to the JS frontend.
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

// Implement From<String> so we can easily map string errors from third-party crates or custom messages
impl From<String> for AppError {
    fn from(s: String) -> Self {
        Self::Generic(s)
    }
}

// Implement From<&str> for convenience
impl From<&str> for AppError {
    fn from(s: &str) -> Self {
        Self::Generic(s.to_string())
    }
}
