use crate::error::AppError;
use crate::models::link::{LinkEntry, LinkMethod, LinkRequest};
use crate::services::link::*;
use crate::state::app_state::{AppState, LockExt, LogLevel, PtyState};
use std::path::Path;
use tauri::State;
#[tauri::command]
#[specta::specta]

pub async fn create_link(
    request: LinkRequest,
    state: State<'_, AppState>,
) -> Result<LinkEntry, AppError> {
    let mut request = request;
    request.allow_lifecycle_scripts = state
        .persistent
        .lock_safe()
        .config
        .as_ref()
        .map(|c| c.general.allow_lifecycle_scripts)
        .unwrap_or(false);

    let result = match request.method {
        LinkMethod::Symlink => link_via_symlink_internal(&request).await,
        LinkMethod::NpmPack => link_via_pack_internal(&request).await,
        LinkMethod::Yalc => link_via_yalc_internal(&request).await,
        LinkMethod::Workspace => link_via_workspace_internal(&request).await,
        LinkMethod::FileCopy => link_via_file_copy_internal(&request).await,
    };

    match result {
        Ok(mut link_entry) => {
            let has_cli = if let Ok(content) =
                std::fs::read_to_string(Path::new(&request.source_path).join("package.json"))
            {
                if let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&content) {
                    pkg.get("bin").is_some()
                } else {
                    false
                }
            } else {
                false
            };
            link_entry.has_cli = has_cli;

            state
                .persistent
                .lock_safe()
                .active_links
                .push(link_entry.clone());
            state.save();
            state.add_log(
                LogLevel::Success,
                format!(
                    "Linked {} to {} via {:?}",
                    link_entry.source_package, link_entry.target_project, link_entry.method
                ),
                "LinkManager".to_string(),
            );
            Ok(link_entry)
        }
        Err(e) => {
            state.add_log(
                LogLevel::Error,
                format!("Failed to create link: {}", e),
                "LinkManager".to_string(),
            );
            Err(e)
        }
    }
}

pub async fn remove_link_internal_logic(
    link_id: String,
    state_mutex: &AppState,
    pty_state: &PtyState,
) -> Result<(), AppError> {
    let link_clone = {
        state_mutex
            .persistent
            .lock_safe()
            .active_links
            .iter()
            .find(|l| l.id == link_id)
            .cloned()
    };

    if let Some(link_clone) = link_clone {
        // Remove the actual link (best effort, ignore errors so we can still clean up state)
        let _ = match link_clone.method {
            LinkMethod::Symlink => unlink_symlink(&link_clone).await,
            LinkMethod::NpmPack => unlink_pack(&link_clone).await,
            LinkMethod::Yalc => unlink_yalc(&link_clone).await,
            _ => Ok(()),
        };

        // Cleanup sandbox if applicable
        let sandbox_base = std::env::temp_dir().join("PackagePilot_Sandboxes");
        if sandbox_base.exists() {
            if let Ok(safe_target) =
                crate::utils::safe_path::SafePath::new(&link_clone.target_path, &sandbox_base)
            {
                // First, find and kill any active PTY session sitting in this directory.
                // This releases the lock powershell.exe might hold on the directory.
                let mut sessions_to_kill = Vec::new();
                {
                    let sessions = pty_state.sessions.lock_safe();
                    for (sid, session) in sessions.iter() {
                        if session.directory == link_clone.target_path {
                            sessions_to_kill.push(sid.clone());
                        }
                    }
                }

                for sid in sessions_to_kill {
                    if let Some(mut session) = pty_state.sessions.lock_safe().remove(&sid) {
                        let _ = session.child.kill();
                        std::thread::sleep(std::time::Duration::from_millis(100));
                    }
                }

                // SECURITY: safe_remove_all_retry canonicalizes and walks the
                // tree first, refusing if any symlink inside points outside
                // PackagePilot_Sandboxes — see utils/safe_path.rs.
                if let Err(e) = safe_target.safe_remove_all_retry(5, 500).await {
                    state_mutex.add_log(
                        LogLevel::Error,
                        format!("Could not delete physical sandbox folder: {}", e),
                        "LinkManager".to_string(),
                    );
                    state_mutex.save();
                }
            }
            // If SafePath::new fails, target_path either doesn't exist or isn't
            // actually under the sandbox boundary — nothing to clean up here.
        }
    }

    crate::commands::watcher::stop_watching_impl(&link_id, state_mutex);
    state_mutex
        .persistent
        .lock_safe()
        .active_links
        .retain(|l| l.id != link_id);
    state_mutex.save();
    Ok(())
}

#[tauri::command]
#[specta::specta]

pub async fn remove_link(
    link_id: String,
    state: State<'_, AppState>,
    pty_state: State<'_, PtyState>,
) -> Result<(), AppError> {
    remove_link_internal_logic(link_id, &state, &pty_state).await
}

#[tauri::command]
#[specta::specta]

pub fn list_active_links(state: State<'_, AppState>) -> Result<Vec<LinkEntry>, AppError> {
    Ok(state.persistent.lock_safe().active_links.clone())
}

#[tauri::command]
#[specta::specta]

pub fn toggle_link_watch(
    link_id: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    if let Some(link) = state
        .persistent
        .lock_safe()
        .active_links
        .iter_mut()
        .find(|l| l.id == link_id)
    {
        link.watch_enabled = enabled;
        state.save();
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]

pub fn get_watch_command(source_path: String) -> Result<Option<String>, AppError> {
    let path = std::path::Path::new(&source_path);
    let pkg_json_path = path.join("package.json");
    if let Ok(content) = std::fs::read_to_string(&pkg_json_path) {
        if let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&content) {
            let pm = crate::services::project::detect_pm(path);
            let pm_str = match pm {
                crate::models::project::PackageManager::Pnpm => "pnpm",
                crate::models::project::PackageManager::Yarn => "yarn",
                _ => "npm run",
            };

            if let Some(scripts) = pkg.get("scripts").and_then(|s| s.as_object()) {
                if scripts.contains_key("watch") {
                    return Ok(Some(format!("{} watch", pm_str)));
                } else if scripts.contains_key("build:watch") {
                    return Ok(Some(format!("{} build:watch", pm_str)));
                } else if scripts.contains_key("dev") {
                    return Ok(Some(format!("{} dev", pm_str)));
                }
            }
        }
    }
    Ok(None)
}

#[tauri::command]
#[specta::specta]

pub async fn link_via_symlink(source: String, target: String) -> Result<String, AppError> {
    let request = LinkRequest {
        source_path: source,
        target_path: target,
        method: LinkMethod::Symlink,
        watch: false,
        build_first: false,
        install_peer_deps: false,
        allow_lifecycle_scripts: false,
    };
    link_via_symlink_internal(&request).await.map(|l| l.id)
}

#[tauri::command]
#[specta::specta]

pub async fn link_via_pack(source: String, target: String) -> Result<String, AppError> {
    let request = LinkRequest {
        source_path: source,
        target_path: target,
        method: LinkMethod::NpmPack,
        watch: false,
        build_first: false,
        install_peer_deps: false,
        allow_lifecycle_scripts: false,
    };
    link_via_pack_internal(&request).await.map(|l| l.id)
}

#[tauri::command]
#[specta::specta]

pub async fn link_via_yalc(source: String, target: String) -> Result<String, AppError> {
    let request = LinkRequest {
        source_path: source,
        target_path: target,
        method: LinkMethod::Yalc,
        watch: false,
        build_first: false,
        install_peer_deps: false,
        allow_lifecycle_scripts: false,
    };
    link_via_yalc_internal(&request).await.map(|l| l.id)
}

#[tauri::command]
#[specta::specta]

pub async fn link_via_workspace(source: String, target: String) -> Result<String, AppError> {
    let request = LinkRequest {
        source_path: source,
        target_path: target,
        method: LinkMethod::Workspace,
        watch: false,
        build_first: false,
        install_peer_deps: false,
        allow_lifecycle_scripts: false,
    };
    link_via_workspace_internal(&request).await.map(|l| l.id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn remove_link_internal_logic_stops_the_links_watcher() {
        let state = AppState::new();
        let pty_state = PtyState::new();
        let link_id = "link-1".to_string();

        state.persistent.lock_safe().active_links.push(LinkEntry {
            id: link_id.clone(),
            source_package: "my-lib".to_string(),
            source_path: "/fake/my-lib".to_string(),
            target_project: "my-project".to_string(),
            // Workspace links no-op on unlink, so this stays a pure
            // in-memory-state test with no filesystem/subprocess side effects.
            target_path: "/fake/my-project".to_string(),
            method: LinkMethod::Workspace,
            status: crate::models::link::LinkStatus::Active,
            watch_enabled: true,
            created_at: chrono::Utc::now(),
            last_synced: None,
            has_cli: false,
        });
        state.watchers.lock_safe().insert(
            link_id.clone(),
            std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        );

        remove_link_internal_logic(link_id.clone(), &state, &pty_state)
            .await
            .unwrap();

        assert!(
            !state.watchers.lock_safe().contains_key(&link_id),
            "watcher entry should be removed along with the link"
        );
        assert!(!state
            .persistent
            .lock_safe()
            .active_links
            .iter()
            .any(|l| l.id == link_id));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn remove_link_internal_logic_refuses_to_follow_escaping_symlink_in_sandbox() {
        use std::os::unix::fs::symlink;

        let sandbox_base = std::env::temp_dir().join("PackagePilot_Sandboxes");
        std::fs::create_dir_all(&sandbox_base).unwrap();
        let victim = sandbox_base.join(format!("sandbox_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&victim).unwrap();

        let outside =
            std::env::temp_dir().join(format!("pp_escape_target_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("important.txt"), "do not delete me").unwrap();
        symlink(&outside, victim.join("evil_link")).unwrap();

        let state = AppState::new();
        let pty_state = PtyState::new();
        let link_id = "link-escape-test".to_string();

        state.persistent.lock_safe().active_links.push(LinkEntry {
            id: link_id.clone(),
            source_package: "leaky-pkg".to_string(),
            source_path: "/fake/leaky-pkg".to_string(),
            target_project: "packlab-sandbox".to_string(),
            target_path: victim.to_string_lossy().to_string(),
            method: LinkMethod::Workspace, // no-op unlink, isolates this test to the cleanup path
            status: crate::models::link::LinkStatus::Active,
            watch_enabled: false,
            created_at: chrono::Utc::now(),
            last_synced: None,
            has_cli: false,
        });

        remove_link_internal_logic(link_id, &state, &pty_state)
            .await
            .unwrap();

        assert!(
            outside.join("important.txt").exists(),
            "symlink target outside the sandbox must survive cleanup"
        );

        std::fs::remove_dir_all(&sandbox_base).ok();
        std::fs::remove_dir_all(&outside).unwrap();
    }
}
