#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod commands;
pub mod error;
pub mod models;
pub mod services;
pub mod state;
pub mod utils;

use state::app_state::{AppState, LockExt, PtyState};
use tauri::Manager;

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
            commands::project::get_package_scripts,
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
            commands::get_system_info,
            commands::get_filtered_env_vars,
            commands::quit_app,
            commands::pty::spawn_pty,
            commands::pty::write_pty,
            commands::pty::resize_pty,
            commands::pty::kill_pty,
            commands::pty::attach_pty,
        ]);

    #[cfg(debug_assertions)]
    builder
        .export(
            specta_typescript::Typescript::default(),
            "../src/bindings.ts",
        )
        .expect("Failed to export typescript bindings");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(AppState::new())
        .manage(PtyState::new())
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

            // SECURITY: clean up sandboxes orphaned by a previous crash/force-quit.
            let sandbox_base = std::env::temp_dir().join("PackagePilot_Sandboxes");
            if sandbox_base.exists() {
                commands::project::cleanup_stale_sandboxes(&sandbox_base);
            }

            let window = app.get_webview_window("main").unwrap();
            window.set_title("Package Pilot")?;

            // Spawn background task for state persistence
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));
                loop {
                    interval.tick().await;
                    let state = app_handle.state::<AppState>();
                    if state.dirty.swap(false, std::sync::atomic::Ordering::SeqCst) {
                        let app_handle_clone = app_handle.clone();
                        tokio::task::spawn_blocking(move || {
                            app_handle_clone.state::<AppState>().force_save();
                        });
                    }
                }
            });

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
                commands::project::get_package_scripts,
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
                commands::get_system_info,
                commands::get_filtered_env_vars,
                commands::quit_app,
                commands::pty::spawn_pty,
                commands::pty::write_pty,
                commands::pty::resize_pty,
                commands::pty::kill_pty,
                commands::pty::attach_pty,
            ]);

        builder
            .export(
                specta_typescript::Typescript::default(),
                "../src/bindings.ts",
            )
            .expect("Failed to export typescript bindings");
    }
}
