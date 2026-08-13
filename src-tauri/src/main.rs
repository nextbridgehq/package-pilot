#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod commands;
pub mod error;
pub mod models;
pub mod services;
pub mod state;
pub mod utils;

use state::app_state::{AppState, LockExt, PtyState, RegistryState};
use tauri::Manager;

fn kill_orphaned_verdaccio(app_handle: &tauri::AppHandle) {
    let registry_state = app_handle.state::<RegistryState>();
    let app_state = app_handle.state::<AppState>();
    if let Some(pid) = *registry_state.process_id.lock_safe() {
        if crate::utils::process::process_is_alive(pid) {
            let _ = crate::utils::process::kill_process_tree(pid);
        }
        *registry_state.process_id.lock_safe() = None;
    }
    *app_state.registry_running.lock_safe() = false;
}

fn auto_start_registry_if_configured(app_handle: &tauri::AppHandle) {
    let should_auto_start = app_handle
        .state::<AppState>()
        .persistent
        .lock_safe()
        .config
        .clone()
        .unwrap_or_default()
        .registry
        .auto_start;
    if should_auto_start {
        let app_handle_clone = app_handle.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = commands::registry::start_registry(None, app_handle_clone.clone()).await {
                app_handle_clone.state::<AppState>().add_log(
                    crate::state::app_state::LogLevel::Error,
                    format!("Failed to auto-start registry: {}", e),
                    "Registry".to_string(),
                );
            }
        });
    }
}

fn spawn_state_persistence_task(app_handle: &tauri::AppHandle) {
    let app_handle_clone = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));
        loop {
            interval.tick().await;
            let state = app_handle_clone.state::<AppState>();
            if state.dirty.swap(false, std::sync::atomic::Ordering::SeqCst) {
                let inner_clone = app_handle_clone.clone();
                tokio::task::spawn_blocking(move || {
                    inner_clone.state::<AppState>().force_save();
                });
            }
        }
    });
}

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    std::panic::set_hook(Box::new(|info| {
        if let Some(mut data_dir) = dirs::data_dir() {
            data_dir.push("PackagePilot");
            let _ = std::fs::create_dir_all(&data_dir);
            let log_path = data_dir.join("crash.log");
            let _ = std::fs::write(&log_path, format!("{:?}", info));
        }
    }));

    let builder =
        tauri_specta::Builder::<tauri::Wry>::new().commands(tauri_specta::collect_commands![
            // Project commands
            commands::project::add_project,
            commands::project::remove_project,
            commands::project::remove_package,
            commands::project::list_projects,
            commands::project::refresh_project,
            commands::project::scan_project,
            commands::project::check_package_cli,
            commands::project::create_sandbox,
            commands::project::run_sandbox_script,
            commands::project::run_workspace_task,
            commands::project::run_package_task,
            commands::project::get_package_scripts,
            commands::project::run_security_audit,
            commands::project::get_directory_size,
            commands::project::get_directory_sizes,
            // Package commands
            commands::package_manager::detect_package_manager,
            commands::package_manager::get_package_info,
            commands::package_manager::npm_pack_dry_run,
            // Link commands
            commands::link::create_link,
            commands::link::remove_link,
            commands::link::list_active_links,
            commands::link::toggle_link_watch,
            commands::link::get_watch_command,
            commands::link::link_via_symlink,
            commands::link::link_via_pack,
            commands::link::link_via_yalc,
            commands::link::link_via_workspace,
            // Watcher commands
            commands::watcher::start_watching,
            commands::watcher::stop_watching,
            commands::watcher::get_watcher_status,
            // Build commands
            commands::build::run_build,
            commands::build::run_install,
            // Registry commands
            commands::registry::start_registry,
            commands::registry::stop_registry,
            commands::registry::publish_to_registry,
            commands::registry::list_registry_packages,
            commands::registry::get_registry_status,
            // Doctor commands
            commands::doctor::run_diagnostics,
            commands::doctor::check_symlink_permissions,
            commands::doctor::check_node_installation,
            commands::doctor::export_diagnostics,
            // Config commands
            commands::config::get_config,
            commands::config::save_config,
            // Log commands
            commands::logs::get_logs,
            commands::logs::clear_logs,
            // Utility commands
            commands::open_folder_dialog,
            commands::open_terminal,
            commands::open_in_explorer,
            commands::open_url,
            commands::get_system_info,
            commands::get_filtered_env_vars,
            commands::quit_app,
            commands::pty::spawn_pty,
            commands::pty::write_pty,
            commands::pty::resize_pty,
            commands::pty::kill_pty,
            commands::pty::attach_pty,
            // Analytics commands
            commands::analytics::get_analytics_summary,
            commands::analytics::record_task_execution,
        ]);

    #[cfg(debug_assertions)]
    builder
        .export(
            specta_typescript::Typescript::default(),
            "../src/bindings.ts",
        )
        .expect("Failed to export typescript bindings");

    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(AppState::new())
        .manage(PtyState::new())
        .manage(RegistryState::new())
        .invoke_handler(builder.invoke_handler())
        .setup(|app| {
            if let Ok(data_dir) = app.path().app_data_dir() {
                let state = app.state::<AppState>();
                state.load(&data_dir);
            }
            {
                let state = app.state::<AppState>();
                *state.app_handle.lock_safe() = Some(app.handle().clone());
            }

            kill_orphaned_verdaccio(app.handle());

            // SECURITY: clean up sandboxes orphaned by a previous crash/force-quit.
            let sandbox_base = std::env::temp_dir().join("PackagePilot_Sandboxes");
            if sandbox_base.exists() {
                commands::project::cleanup_stale_sandboxes(&sandbox_base);
            }

            auto_start_registry_if_configured(app.handle());

            let window = app.get_webview_window("main").unwrap();
            window.set_title("Package Pilot")?;

            spawn_state_persistence_task(app.handle());

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Package Pilot")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let state = app_handle.state::<AppState>();
                if state.dirty.load(std::sync::atomic::Ordering::SeqCst) {
                    state.force_save();
                }

                let pty_state = app_handle.state::<PtyState>();
                pty_state.sessions.lock_safe().clear();

                let app_state = app_handle.state::<AppState>();
                let mut watchers = app_state.watchers.lock_safe();
                for (_, token) in watchers.iter() {
                    token.store(true, std::sync::atomic::Ordering::Relaxed);
                }
                watchers.clear();

                let pid = {
                    let registry_state = app_handle.state::<RegistryState>();
                    let x = registry_state.process_id.lock_safe().take();
                    x
                };
                if let Some(p) = pid {
                    let _ = crate::utils::process::kill_process_tree(p);
                }
            }
        });
} // force rebuild

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_bindings() {
        let builder =
            tauri_specta::Builder::<tauri::Wry>::new().commands(tauri_specta::collect_commands![
                // Project commands
                commands::project::add_project,
                commands::project::remove_project,
                commands::project::remove_package,
                commands::project::list_projects,
                commands::project::refresh_project,
                commands::project::scan_project,
                commands::project::check_package_cli,
                commands::project::create_sandbox,
                commands::project::run_sandbox_script,
                commands::project::run_workspace_task,
                commands::project::run_package_task,
                commands::project::get_package_scripts,
                commands::project::run_security_audit,
                commands::project::get_directory_size,
                commands::project::get_directory_sizes,
                // Package commands
                commands::package_manager::detect_package_manager,
                commands::package_manager::get_package_info,
                commands::package_manager::npm_pack_dry_run,
                // Link commands
                commands::link::create_link,
                commands::link::remove_link,
                commands::link::list_active_links,
                commands::link::toggle_link_watch,
                commands::link::get_watch_command,
                commands::link::link_via_symlink,
                commands::link::link_via_pack,
                commands::link::link_via_yalc,
                commands::link::link_via_workspace,
                // Watcher commands
                commands::watcher::start_watching,
                commands::watcher::stop_watching,
                commands::watcher::get_watcher_status,
                // Build commands
                commands::build::run_build,
                commands::build::run_install,
                // Registry commands
                commands::registry::start_registry,
                commands::registry::stop_registry,
                commands::registry::publish_to_registry,
                commands::registry::list_registry_packages,
                commands::registry::get_registry_status,
                // Doctor commands
                commands::doctor::run_diagnostics,
                commands::doctor::check_symlink_permissions,
                commands::doctor::check_node_installation,
                commands::doctor::export_diagnostics,
                // Config commands
                commands::config::get_config,
                commands::config::save_config,
                // Log commands
                commands::logs::get_logs,
                commands::logs::clear_logs,
                // Utility commands
                commands::open_folder_dialog,
                commands::open_terminal,
                commands::open_in_explorer,
                commands::open_url,
                commands::get_system_info,
                commands::get_filtered_env_vars,
                commands::quit_app,
                commands::pty::spawn_pty,
                commands::pty::write_pty,
                commands::pty::resize_pty,
                commands::pty::kill_pty,
                commands::pty::attach_pty,
                // Analytics commands
                commands::analytics::get_analytics_summary,
                commands::analytics::record_task_execution,
            ]);

        builder
            .export(
                specta_typescript::Typescript::default(),
                "../src/bindings.ts",
            )
            .expect("Failed to export typescript bindings");
    }
}
