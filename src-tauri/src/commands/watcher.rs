use crate::state::app_state::{AppState, LockExt, LogLevel};
use tauri::{Emitter, State};

/// Returns true if a watcher was actually running (and is now stopped);
/// false if link_id had no active watcher, so callers can tell a real
/// stop apart from a no-op.
pub fn stop_watching_impl(link_id: &str, state: &AppState) -> bool {
    if let Some(token) = state.watchers.lock_safe().remove(link_id) {
        token.store(true, std::sync::atomic::Ordering::Relaxed);
        true
    } else {
        false
    }
}

pub fn get_watcher_status_impl(state: &AppState) -> std::collections::HashMap<String, bool> {
    state
        .watchers
        .lock_safe()
        .keys()
        .map(|k| (k.clone(), true))
        .collect()
}

pub fn build_ignore_globset(patterns: &[String]) -> globset::GlobSet {
    let mut builder = globset::GlobSetBuilder::new();
    for pat in patterns {
        let mut pattern = pat.clone();
        if !pattern.contains('*') && !pattern.contains('/') {
            pattern = format!("**/{}/**", pattern);
        }
        if let Ok(glob) = globset::Glob::new(&pattern) {
            builder.add(glob);
        }
    }
    builder
        .build()
        .unwrap_or_else(|_| globset::GlobSetBuilder::new().build().unwrap())
}

#[tauri::command]
#[specta::specta]

pub async fn start_watching(
    link_id: String,
    path: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    // Prevent starting multiple watchers for the same link
    if state.watchers.lock_safe().contains_key(&link_id) {
        return Ok(());
    }

    let cancel_token = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    state
        .watchers
        .lock_safe()
        .insert(link_id.clone(), cancel_token.clone());

    // Spawn a thread for file watching
    let app_handle = app.clone();
    let watch_path = path.clone();
    let watcher_link_id = link_id.clone();

    let debounce_ms = state
        .persistent
        .lock_safe()
        .config
        .as_ref()
        .map(|c| c.watcher.debounce_ms)
        .unwrap_or(500);
    let ignore_patterns = state
        .persistent
        .lock_safe()
        .config
        .as_ref()
        .map(|c| c.watcher.ignore_patterns.clone())
        .unwrap_or_default();

    use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
    use std::sync::mpsc::channel;
    use std::time::Duration;

    let (tx, rx) = channel();

    let mut watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                let _ = tx.send(event);
            }
        },
        Config::default().with_poll_interval(Duration::from_millis(debounce_ms as u64)),
    )
    .map_err(|e| {
        state.watchers.lock_safe().remove(&watcher_link_id);
        state.add_log(
            LogLevel::Error,
            format!("Failed to create watcher for {}: {}", watch_path, e),
            "Watcher".to_string(),
        );
        format!("Failed to create watcher: {}", e)
    })?;

    if let Err(e) = watcher.watch(std::path::Path::new(&watch_path), RecursiveMode::Recursive) {
        state.watchers.lock_safe().remove(&watcher_link_id);
        state.add_log(
            LogLevel::Error,
            format!("Failed to watch {}: {}", watch_path, e),
            "Watcher".to_string(),
        );
        return Err(format!("Failed to watch path: {}", e));
    }

    state.add_log(
        LogLevel::Success,
        format!("Started watching {}", path),
        "Watcher".to_string(),
    );

    std::thread::spawn(move || {
        let _watcher = watcher; // Keep watcher alive
        let mut pending_paths: Vec<(std::path::PathBuf, String)> = Vec::new();
        let debounce_duration = Duration::from_millis(debounce_ms as u64);

        let globset = build_ignore_globset(&ignore_patterns);

        loop {
            if cancel_token.load(std::sync::atomic::Ordering::Relaxed) {
                break;
            }

            let timeout = if pending_paths.is_empty() {
                Duration::from_millis(100)
            } else {
                debounce_duration
            };

            match rx.recv_timeout(timeout) {
                Ok(event) => {
                    let should_ignore = event.paths.iter().any(|p| {
                        let path_str = p.to_string_lossy().replace("\\", "/");
                        globset.is_match(&path_str)
                    });

                    if !should_ignore {
                        let kind_str = match event.kind {
                            notify::EventKind::Create(_) => "Created",
                            notify::EventKind::Remove(_) => "Deleted",
                            notify::EventKind::Modify(_) => "Modified",
                            notify::EventKind::Access(_) => "Accessed",
                            notify::EventKind::Any => "Changed",
                            notify::EventKind::Other => "Changed",
                        };
                        for path in &event.paths {
                            pending_paths.push((path.clone(), kind_str.to_string()));
                        }
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    if !pending_paths.is_empty() {
                        pending_paths.sort_by(|a, b| a.0.cmp(&b.0));
                        pending_paths.dedup_by(|a, b| a.0 == b.0);

                        let _ = app_handle.emit(
                            "file-changed",
                            serde_json::json!({
                                "link_id": watcher_link_id,
                                "paths": pending_paths.iter().map(|(p, _)| p.to_string_lossy().to_string()).collect::<Vec<_>>(),
                                "kind": pending_paths.iter().map(|(_, k)| k.as_str()).collect::<Vec<_>>().join(", "),
                            }),
                        );
                        pending_paths.clear();
                    }
                }
                Err(e) => {
                    if !cancel_token.load(std::sync::atomic::Ordering::Relaxed) {
                        use tauri::Manager;
                        if let Some(app_state) = app_handle.try_state::<AppState>() {
                            app_state.watchers.lock_safe().remove(&watcher_link_id);
                            app_state.add_log(
                                LogLevel::Error,
                                format!(
                                    "Watcher {} disconnected unexpectedly: {:?}",
                                    watcher_link_id, e
                                ),
                                "Watcher".to_string(),
                            );
                        }
                    }
                    break;
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
#[specta::specta]

pub async fn stop_watching(link_id: String, state: State<'_, AppState>) -> Result<(), String> {
    if stop_watching_impl(&link_id, &state) {
        state.add_log(
            LogLevel::Success,
            "Stopped watching".to_string(),
            "Watcher".to_string(),
        );
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]

pub async fn get_watcher_status(
    state: State<'_, AppState>,
) -> Result<std::collections::HashMap<String, bool>, String> {
    Ok(get_watcher_status_impl(&state))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stop_watching_impl_removes_and_signals_cancellation() {
        let state = AppState::new();
        let token = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        state
            .watchers
            .lock_safe()
            .insert("link-1".to_string(), token.clone());

        let stopped = stop_watching_impl("link-1", &state);

        assert!(stopped);
        assert!(token.load(std::sync::atomic::Ordering::Relaxed));
        assert!(!state.watchers.lock_safe().contains_key("link-1"));
    }

    #[test]
    fn stop_watching_impl_is_noop_for_unknown_link() {
        let state = AppState::new();
        let stopped = stop_watching_impl("does-not-exist", &state); // must not panic
        assert!(!stopped);
    }

    #[test]
    fn get_watcher_status_impl_reports_all_registered_links_as_active() {
        let state = AppState::new();
        state.watchers.lock_safe().insert(
            "link-1".to_string(),
            std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        );

        let status = get_watcher_status_impl(&state);

        assert_eq!(status.get("link-1"), Some(&true));
    }

    #[test]
    fn build_ignore_globset_matches_bare_dir_name_anywhere() {
        let globset = build_ignore_globset(&["node_modules".to_string()]);
        assert!(globset.is_match(std::path::Path::new("project/node_modules/pkg/index.js")));
        assert!(!globset.is_match(std::path::Path::new("project/src/index.js")));
    }

    #[test]
    fn build_ignore_globset_respects_explicit_glob_patterns() {
        let globset = build_ignore_globset(&["**/*.log".to_string()]);
        assert!(globset.is_match(std::path::Path::new("project/logs/debug.log")));
        assert!(!globset.is_match(std::path::Path::new("project/logs/debug.txt")));
    }
}
