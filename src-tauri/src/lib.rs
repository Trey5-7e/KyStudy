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
        .register_uri_scheme_protocol("kystudy-pdf", |context, request| {
            context
                .app_handle()
                .try_state::<bootstrap::AppState>()
                .map_or_else(
                    || tauri::http::Response::new(b"RESOURCE_UNAVAILABLE".to_vec()),
                    |state| infrastructure::respond_pdf(&state.resources, &request),
                )
        })
        .register_uri_scheme_protocol("kystudy-image", |context, request| {
            context
                .app_handle()
                .try_state::<bootstrap::AppState>()
                .map_or_else(
                    || tauri::http::Response::new(b"RESOURCE_UNAVAILABLE".to_vec()),
                    |state| infrastructure::respond_image(&state.resources, &request),
                )
        })
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
            commands::split_task,
            commands::trash_task,
            commands::list_trashed_tasks,
            commands::restore_trashed_task,
            commands::list_overdue_tasks,
            commands::create_study_session,
            commands::list_study_sessions,
            commands::get_study_statistics,
            commands::list_resources,
            commands::get_resource_reader_descriptor,
            commands::update_resource_role,
            commands::save_resource_reading_progress,
            commands::list_study_plans,
            commands::save_study_plan,
            commands::set_study_plan_status,
            commands::save_plan_stage,
            commands::delete_plan_stage,
            commands::add_plan_reference,
            commands::delete_plan_reference,
            commands::list_knowledge_maps,
            commands::create_knowledge_map,
            commands::update_knowledge_map,
            commands::duplicate_knowledge_map,
            commands::trash_knowledge_map,
            commands::create_knowledge_node,
            commands::update_knowledge_node,
            commands::move_knowledge_node,
            commands::delete_knowledge_subtree,
            commands::set_knowledge_node_collapsed,
            commands::add_knowledge_node_resource,
            commands::delete_knowledge_node_resource,
            commands::undo_knowledge_map,
            commands::redo_knowledge_map,
            commands::list_mindmap_import_drafts,
            commands::create_mindmap_import_draft,
            commands::accept_mindmap_import_draft,
            commands::reject_mindmap_import_draft,
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
