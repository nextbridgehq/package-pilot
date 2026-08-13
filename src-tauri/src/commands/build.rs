use crate::error::AppError;
use crate::state::app_state::{AppState, LogLevel};
use tauri::{Emitter, State};

#[tauri::command]
#[specta::specta]

pub async fn run_build(
    path: String,
    script: Option<String>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let build_script = script.unwrap_or_else(|| "build".to_string());

    let _ = app.emit("build-started", &path);

    let pm = crate::services::project::resolve_package_manager(std::path::Path::new(&path), None);
    let engine = crate::services::project::get_engine(pm);
    let cmd = engine.run_script_cmd(&build_script, &[]);

    let output = crate::services::shell::run_command_raw(
        &cmd.program,
        &cmd.args.iter().map(|s| s.as_str()).collect::<Vec<&str>>(),
        &path,
        std::time::Duration::from_secs(300),
    )
    .await?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        let _ = app.emit(
            "build-failed",
            serde_json::json!({
                "path": path,
                "error": stderr,
            }),
        );
        state.add_log(
            LogLevel::Error,
            format!("Build failed for {}: {}", path, stderr),
            "BuildManager".to_string(),
        );
        return Err(AppError::Generic(format!("Build failed: {}", stderr)));
    }

    let _ = app.emit("build-completed", &path);
    state.add_log(
        LogLevel::Success,
        format!("Build completed for {}", path),
        "BuildManager".to_string(),
    );
    Ok(stdout)
}

#[tauri::command]
#[specta::specta]

pub async fn run_install(
    path: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let _ = app.emit("install-started", &path);

    let pm = crate::services::project::resolve_package_manager(std::path::Path::new(&path), None);
    let engine = crate::services::project::get_engine(pm);
    let opts = crate::models::project::InstallOptions {
        target_tarball: None,
        ignore_scripts: false,
        no_save: false,
    };
    let cmd = engine.install_cmd(&opts);

    let output = crate::services::shell::run_command_raw(
        &cmd.program,
        &cmd.args.iter().map(|s| s.as_str()).collect::<Vec<&str>>(),
        &path,
        std::time::Duration::from_secs(300),
    )
    .await?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let _ = app.emit(
            "install-failed",
            serde_json::json!({
                "path": path,
                "error": stderr,
            }),
        );
        state.add_log(
            LogLevel::Error,
            format!("Install failed for {}: {}", path, stderr),
            "BuildManager".to_string(),
        );
        return Err(AppError::Generic(format!("Install failed: {}", stderr)));
    }

    let _ = app.emit("install-completed", &path);
    state.add_log(
        LogLevel::Success,
        format!("Install completed for {}", path),
        "BuildManager".to_string(),
    );
    Ok(stdout)
}

#[cfg(test)]
mod tests {
    use crate::services::project::{get_engine, resolve_package_manager};
    use crate::models::project::PackageManager;
    use std::path::Path;

    #[test]
    fn test_build_engine_dispatch() {
        let pm = resolve_package_manager(Path::new("."), Some(PackageManager::Pnpm));
        let engine = get_engine(pm);
        let cmd = engine.run_script_cmd("build", &[]);
        assert_eq!(cmd.program, "pnpm");
        assert_eq!(cmd.args, vec!["run", "build"]);
    }
}

