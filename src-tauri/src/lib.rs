//! `KyStudy` desktop composition root.

mod application;
mod bootstrap;
mod commands;
mod domain;
mod infrastructure;

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use tauri::Manager;

const APPLICATION_DATA_DIRECTORY_OVERRIDE_ENV: &str = "KYSTUDY_APP_DATA_DIR";

fn debug_application_data_directory(directory: &Path) -> PathBuf {
    #[cfg(debug_assertions)]
    {
        let name = directory
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("io.github.kystudy.desktop");
        directory.with_file_name(format!("{name}-dev"))
    }

    #[cfg(not(debug_assertions))]
    {
        directory.to_path_buf()
    }
}

fn resolve_application_data_directory(
    app: &tauri::App,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let directory = app.path().app_data_dir()?;
    resolve_configured_application_data_directory(
        &directory,
        std::env::var_os(APPLICATION_DATA_DIRECTORY_OVERRIDE_ENV),
    )
}

fn resolve_configured_application_data_directory(
    directory: &Path,
    override_directory: Option<OsString>,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let Some(override_directory) = override_directory.filter(|value| !value.is_empty()) else {
        return Ok(debug_application_data_directory(directory));
    };

    let override_directory = PathBuf::from(override_directory);
    if !override_directory.is_absolute() {
        return Err(Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("{APPLICATION_DATA_DIRECTORY_OVERRIDE_ENV} must be an absolute path"),
        )));
    }

    Ok(override_directory)
}

fn initialize_application(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let application_data_directory = resolve_application_data_directory(app)?;
    let state = bootstrap::AppState::new(&application_data_directory);
    if let Err(error) = state.resources.recover_and_list() {
        eprintln!("KYSTUDY_IMPORT_RECOVERY_FAILED: {}", error.code());
    }
    if let Err(error) = state.search.recover_interrupted() {
        eprintln!("KYSTUDY_INDEX_RECOVERY_FAILED: {}", error.code());
    }
    if let Err(error) = state.ai.recover_interrupted() {
        eprintln!("KYSTUDY_AI_RECOVERY_FAILED: {}", error.code());
    }
    app.manage(state);
    Ok(())
}

macro_rules! kystudy_command_handler {
    () => {
        tauri::generate_handler![
            commands::get_runtime_status,
            commands::get_analytics_overview,
            commands::get_plan_execution_progress,
            commands::get_ai_overview,
            commands::create_ai_provider,
            commands::update_ai_provider,
            commands::activate_ai_provider,
            commands::delete_ai_provider,
            commands::save_ai_budget,
            commands::save_ai_secret,
            commands::delete_ai_secret,
            commands::preview_ai_call,
            commands::execute_ai_call,
            commands::preview_question_ai_analysis,
            commands::execute_question_ai_analysis,
            commands::list_planning_conversations,
            commands::create_planning_conversation,
            commands::preview_planning_chat,
            commands::execute_planning_chat,
            commands::save_planning_reply_as_draft,
            commands::get_workspace_status,
            commands::initialize_default_workspace,
            commands::list_subjects,
            commands::create_subject,
            commands::archive_subject,
            commands::rename_subject,
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
            commands::list_resource_index_statuses,
            commands::begin_resource_index,
            commands::store_resource_page_text,
            commands::complete_resource_index,
            commands::interrupt_resource_index,
            commands::fail_resource_index,
            commands::clear_resource_index,
            commands::search_resources,
            commands::list_study_plans,
            commands::save_study_plan,
            commands::set_study_plan_status,
            commands::save_plan_stage,
            commands::delete_plan_stage,
            commands::add_plan_reference,
            commands::delete_plan_reference,
            commands::preview_plan_stage_tasks,
            commands::confirm_plan_stage_tasks,
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
            commands::list_workbook_questions,
            commands::get_question_bank,
            commands::list_trashed_workbook_segments,
            commands::get_question_gap_acknowledgements,
            commands::set_question_gap_acknowledgement,
            commands::create_workbook_category,
            commands::archive_workbook_category,
            commands::rename_workbook_category,
            commands::save_workbook_segments,
            commands::import_question_index,
            commands::record_bulk_question_attempts,
            commands::update_indexed_question,
            commands::replace_indexed_question_regions,
            commands::insert_indexed_question,
            commands::trash_indexed_question,
            commands::trash_workbook_segment,
            commands::restore_workbook_segment,
            commands::reassign_workbook_segment,
            commands::get_workbook_profile,
            commands::set_workbook_default_subject,
            commands::batch_classify_questions,
            commands::list_trashed_questions,
            commands::create_question,
            commands::update_question,
            commands::add_question_region,
            commands::update_question_region,
            commands::delete_question_region,
            commands::add_question_attempt,
            commands::trash_question,
            commands::restore_question,
            commands::get_ocr_status,
            commands::get_ocr_download_info,
            commands::download_ocr_component,
            commands::install_ocr_component,
            commands::remove_ocr_component,
            commands::list_question_ocr,
            commands::recognize_question_region,
            commands::recognize_pdf_page,
            commands::cancel_ocr,
            commands::confirm_question_region_ocr,
            commands::discard_question_region_ocr,
            commands::get_review_dashboard,
            commands::update_review_preferences,
            commands::set_question_review,
            commands::pin_question_review,
            commands::generate_daily_review_queue,
            commands::insert_daily_review_item,
            commands::submit_review_result,
            commands::get_review_scheme_dashboard,
            commands::save_review_scheme,
            commands::archive_review_scheme,
            commands::set_review_rest_weekdays,
            commands::generate_review_scheme_queue,
            commands::submit_review_scheme_result,
            commands::undo_review_scheme_result,
            commands::get_cycle_plan_dashboard,
            commands::save_cycle_plan,
            commands::set_cycle_plan_item_state,
            commands::restore_cycle_plan_item_state,
            commands::preview_cycle_plan_shift,
            commands::confirm_cycle_plan_shift,
            commands::undo_shift_cycle_plan,
            commands::archive_cycle_plan,
            commands::refresh_cycle_plan_schedules,
            commands::start_resource_import,
            commands::trash_resource,
            commands::cancel_resource_import,
            commands::create_workspace_backup,
            commands::restore_workspace_backup
        ]
    };
}

/// Starts the `KyStudy` desktop runtime and registers its controlled command boundary.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
        .setup(initialize_application)
        .invoke_handler(kystudy_command_handler!())
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| {
            eprintln!("KYSTUDY_RUNTIME_START_FAILED: {error}");
            std::process::exit(1);
        });
}

#[cfg(test)]
mod tests {
    use super::{debug_application_data_directory, resolve_configured_application_data_directory};
    use std::ffi::OsString;
    use std::path::{Path, PathBuf};

    #[test]
    fn debug_data_directory_is_separate_from_release_data() {
        let release_directory =
            PathBuf::from(r"C:\Users\tester\AppData\Roaming\io.github.kystudy.desktop");
        let resolved = debug_application_data_directory(&release_directory);

        #[cfg(debug_assertions)]
        assert_eq!(
            resolved,
            PathBuf::from(r"C:\Users\tester\AppData\Roaming\io.github.kystudy.desktop-dev")
        );

        #[cfg(not(debug_assertions))]
        assert_eq!(resolved, release_directory);
    }

    #[test]
    fn explicit_data_directory_override_is_used_as_is() {
        let default_directory =
            PathBuf::from(r"C:\Users\tester\AppData\Roaming\io.github.kystudy.desktop");
        let override_directory = PathBuf::from(r"C:\Temp\kystudy-clean-release");

        let resolved = resolve_configured_application_data_directory(
            &default_directory,
            Some(override_directory.as_os_str().to_os_string()),
        )
        .expect("absolute data directory override should be accepted");

        assert_eq!(resolved, override_directory);
    }

    #[test]
    fn relative_data_directory_override_is_rejected() {
        let result = resolve_configured_application_data_directory(
            Path::new(r"C:\Users\tester\AppData\Roaming\io.github.kystudy.desktop"),
            Some(OsString::from("relative-path")),
        );

        assert!(result.is_err());
    }
}
