//! `KyStudy` desktop composition root.

mod application;
mod bootstrap;
mod commands;
mod domain;
mod infrastructure;

use tauri::Manager;

/// Starts the `KyStudy` desktop runtime and registers its controlled command boundary.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let application_data_directory = app.path().app_data_dir()?;
            let state = bootstrap::AppState::new(&application_data_directory);
            if let Err(error) = state.resources.recover_and_list() {
                eprintln!("KYSTUDY_IMPORT_RECOVERY_FAILED: {}", error.code());
            }
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_runtime_status,
            commands::get_workspace_status,
            commands::initialize_default_workspace,
            commands::list_subjects,
            commands::create_subject,
            commands::archive_subject,
            commands::list_tasks_for_range,
            commands::create_task,
            commands::update_task_details,
            commands::reschedule_task,
            commands::transition_task,
            commands::list_task_changes,
            commands::list_resources,
            commands::start_resource_import,
            commands::cancel_resource_import,
            commands::create_workspace_backup,
            commands::restore_workspace_backup
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| {
            eprintln!("KYSTUDY_RUNTIME_START_FAILED: {error}");
            std::process::exit(1);
        });
}
