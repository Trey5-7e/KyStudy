//! `KyStudy` desktop composition root.

mod application;
mod bootstrap;
mod commands;
mod domain;
mod infrastructure;

#[cfg(any(not(debug_assertions), test))]
use std::ffi::OsStr;
use std::ffi::OsString;
#[cfg(any(not(debug_assertions), test))]
use std::fs;
#[cfg(any(not(debug_assertions), test))]
use std::io::Read;
use std::path::{Path, PathBuf};
#[cfg(any(not(debug_assertions), test))]
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(any(not(debug_assertions), test))]
use sha2::{Digest, Sha256};
use tauri::Manager;

const APPLICATION_DATA_DIRECTORY_OVERRIDE_ENV: &str = "KYSTUDY_APP_DATA_DIR";
#[cfg(any(not(debug_assertions), test))]
const LEGACY_MIGRATION_MARKER: &str = ".kystudy-legacy-migration-v1";
#[cfg(any(not(debug_assertions), test))]
const DATA_DIRECTORY_MARKER: &str = ".kystudy-data-v1";

#[cfg(any(debug_assertions, test))]
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
    let directory = default_application_data_directory(app)?;
    resolve_configured_application_data_directory(
        &directory,
        std::env::var_os(APPLICATION_DATA_DIRECTORY_OVERRIDE_ENV),
    )
}

fn default_application_data_directory(
    app: &tauri::App,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    #[cfg(debug_assertions)]
    {
        Ok(debug_application_data_directory(
            &app.path().app_data_dir()?,
        ))
    }

    #[cfg(not(debug_assertions))]
    {
        release_application_data_directory(&app.path().resource_dir()?)
    }
}

#[cfg(any(not(debug_assertions), test))]
fn release_application_data_directory(
    resource_directory: &Path,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let install_directory = resource_directory.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Tauri resource directory has no installation parent",
        )
    })?;
    Ok(install_directory.join("data"))
}

fn resolve_configured_application_data_directory(
    directory: &Path,
    override_directory: Option<OsString>,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let Some(override_directory) = override_directory.filter(|value| !value.is_empty()) else {
        return Ok(directory.to_path_buf());
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
    #[cfg(not(debug_assertions))]
    migrate_legacy_application_data_directory(app, &application_data_directory)?;
    std::fs::create_dir_all(&application_data_directory)?;
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
    if let Err(error) = state.planning_chat.expire_temporary_attachments() {
        eprintln!(
            "KYSTUDY_PLANNING_TEMP_ATTACHMENTS_EXPIRE_FAILED: {}",
            error.code()
        );
    }
    if let Err(error) = state.ai_chat.expire_temporary_attachments() {
        eprintln!(
            "KYSTUDY_CHAT_TEMP_ATTACHMENTS_EXPIRE_FAILED: {}",
            error.code()
        );
    }
    app.manage(state);
    Ok(())
}

#[cfg(not(debug_assertions))]
fn migrate_legacy_application_data_directory(
    app: &tauri::App,
    target_directory: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    if std::env::var_os(APPLICATION_DATA_DIRECTORY_OVERRIDE_ENV)
        .as_ref()
        .is_some_and(|value| !value.is_empty())
    {
        return Ok(());
    }

    let legacy_directory = app.path().app_data_dir()?;
    if legacy_directory == target_directory || !legacy_directory.exists() {
        return Ok(());
    }
    migrate_legacy_data_directory(target_directory, &legacy_directory)
}

#[cfg(any(not(debug_assertions), test))]
fn migrate_legacy_data_directory(
    target_directory: &Path,
    legacy_directory: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    if target_directory.join(LEGACY_MIGRATION_MARKER).exists() {
        return Ok(());
    }
    if target_directory.exists()
        && !directory_is_empty_except(target_directory, &[DATA_DIRECTORY_MARKER])?
    {
        return Err(Box::new(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "installation data directory is not empty; legacy workspace was not migrated",
        )));
    }

    let backup_directory = legacy_backup_directory(legacy_directory)?;
    copy_directory(legacy_directory, &backup_directory)?;
    let source_fingerprint = directory_fingerprint(legacy_directory)?;
    if target_directory.exists() {
        copy_directory_contents(legacy_directory, target_directory)?;
    } else {
        copy_directory(legacy_directory, target_directory)?;
    }
    let target_fingerprint =
        directory_fingerprint_excluding(target_directory, &[DATA_DIRECTORY_MARKER])?;
    if source_fingerprint != target_fingerprint {
        let _ = fs::remove_dir_all(target_directory);
        return Err(Box::new(std::io::Error::other(
            "legacy workspace verification failed; source data was preserved",
        )));
    }
    fs::write(
        target_directory.join(LEGACY_MIGRATION_MARKER),
        b"legacy workspace copied and verified; source retained as rollback copy\n",
    )?;
    Ok(())
}

#[cfg(any(not(debug_assertions), test))]
fn legacy_backup_directory(legacy_directory: &Path) -> Result<PathBuf, std::io::Error> {
    let name = legacy_directory
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("kystudy-workspace");
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(std::io::Error::other)?
        .as_millis();
    Ok(legacy_directory.with_file_name(format!("{name}.backup-{timestamp}")))
}

#[cfg(any(not(debug_assertions), test))]
fn directory_is_empty_except(
    directory: &Path,
    ignored_names: &[&str],
) -> Result<bool, std::io::Error> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        if ignored_names
            .iter()
            .any(|name| entry.file_name() == OsStr::new(name))
        {
            continue;
        }
        return Ok(false);
    }
    Ok(true)
}

#[cfg(any(not(debug_assertions), test))]
fn copy_directory(source: &Path, target: &Path) -> Result<(), std::io::Error> {
    fs::create_dir_all(target)?;
    copy_directory_contents(source, target)
}

#[cfg(any(not(debug_assertions), test))]
fn copy_directory_contents(source: &Path, target: &Path) -> Result<(), std::io::Error> {
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_directory(&source_path, &target_path)?;
        } else if entry.file_type()?.is_file() {
            fs::copy(source_path, target_path)?;
        }
    }
    Ok(())
}

#[cfg(any(not(debug_assertions), test))]
fn directory_fingerprint(directory: &Path) -> Result<(u64, u64, [u8; 32]), std::io::Error> {
    directory_fingerprint_excluding(directory, &[])
}

#[cfg(any(not(debug_assertions), test))]
fn directory_fingerprint_excluding(
    directory: &Path,
    ignored_names: &[&str],
) -> Result<(u64, u64, [u8; 32]), std::io::Error> {
    let mut entries = fs::read_dir(directory)?.collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(std::fs::DirEntry::file_name);
    let mut files = 0;
    let mut bytes = 0;
    let mut hasher = Sha256::new();
    for entry in entries {
        if ignored_names
            .iter()
            .any(|name| entry.file_name() == OsStr::new(name))
        {
            continue;
        }
        let path = entry.path();
        let name = entry.file_name();
        if entry.file_type()?.is_dir() {
            let (nested_files, nested_bytes, nested_hash) =
                directory_fingerprint_excluding(&path, ignored_names)?;
            files += nested_files;
            bytes += nested_bytes;
            hasher.update(b"D");
            hasher.update(name.to_string_lossy().as_bytes());
            hasher.update(nested_hash);
        } else if entry.file_type()?.is_file() {
            files += 1;
            let mut file = fs::File::open(path)?;
            let mut content = Vec::new();
            file.read_to_end(&mut content)?;
            bytes += content.len() as u64;
            hasher.update(b"F");
            hasher.update(name.to_string_lossy().as_bytes());
            hasher.update(content);
        }
    }
    Ok((files, bytes, hasher.finalize().into()))
}

macro_rules! kystudy_command_handler {
    () => {
        tauri::generate_handler![
            commands::get_runtime_status,
            commands::get_analytics_overview,
            commands::get_plan_execution_progress,
            commands::get_ai_overview,
            commands::list_ai_models,
            commands::save_paper_pdf,
            commands::create_ai_provider,
            commands::update_ai_provider,
            commands::save_ai_provider_capabilities,
            commands::activate_ai_provider,
            commands::delete_ai_provider,
            commands::save_ai_budget,
            commands::save_ai_secret,
            commands::delete_ai_secret,
            commands::preview_ai_call,
            commands::execute_ai_call,
            commands::preview_question_ai_analysis,
            commands::get_question_ai_analysis,
            commands::list_question_ai_analysis_history,
            commands::execute_question_ai_analysis,
            commands::list_planning_conversations,
            commands::create_planning_conversation,
            commands::rename_planning_conversation,
            commands::delete_planning_conversation,
            commands::list_ai_attachments,
            commands::attach_resource_to_ai_conversation,
            commands::attach_temporary_ai_attachment,
            commands::remove_ai_attachment,
            commands::retry_ai_attachment,
            commands::preview_planning_chat,
            commands::execute_planning_chat,
            commands::execute_planning_chat_stream,
            commands::cancel_ai_chat,
            commands::save_planning_reply_as_draft,
            commands::list_ai_chat_conversations,
            commands::create_ai_chat_conversation,
            commands::rename_ai_chat_conversation,
            commands::delete_ai_chat_conversation,
            commands::list_ai_chat_attachments,
            commands::attach_resource_to_ai_chat,
            commands::attach_temporary_ai_chat_attachment,
            commands::remove_ai_chat_attachment,
            commands::retry_ai_chat_attachment,
            commands::preview_ai_chat,
            commands::execute_ai_chat,
            commands::execute_ai_chat_stream,
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
            commands::delete_workbook_segment,
            commands::delete_all_trashed_workbook_segments,
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
    use super::{
        DATA_DIRECTORY_MARKER, debug_application_data_directory, migrate_legacy_data_directory,
        release_application_data_directory, resolve_configured_application_data_directory,
    };
    use std::ffi::OsString;
    use std::fs;
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
    fn configured_default_directory_is_not_transformed_again() {
        let default_directory =
            PathBuf::from(r"C:\Users\tester\AppData\Roaming\io.github.kystudy.desktop-dev");

        let resolved = resolve_configured_application_data_directory(&default_directory, None)
            .expect("default data directory should be accepted");

        assert_eq!(resolved, default_directory);
    }

    #[test]
    fn relative_data_directory_override_is_rejected() {
        let result = resolve_configured_application_data_directory(
            Path::new(r"C:\Users\tester\AppData\Roaming\io.github.kystudy.desktop"),
            Some(OsString::from("relative-path")),
        );

        assert!(result.is_err());
    }

    #[test]
    fn release_data_directory_is_next_to_installation() {
        let resource_directory = Path::new(r"D:\Apps\KyStudy\resources");

        let resolved = release_application_data_directory(resource_directory)
            .expect("resource directory should have an installation parent");

        assert_eq!(resolved, PathBuf::from(r"D:\Apps\KyStudy\data"));
    }

    #[test]
    fn release_data_directory_rejects_a_parentless_resource_path() {
        let result = release_application_data_directory(Path::new(""));

        assert!(result.is_err());
    }

    #[test]
    fn legacy_workspace_migration_keeps_a_backup_and_is_idempotent() {
        let root = tempfile::tempdir().expect("temporary root should be created");
        let legacy = root.path().join("legacy");
        let target = root.path().join("install").join("data");
        fs::create_dir_all(legacy.join("workspaces")).expect("legacy workspace should be created");
        fs::write(
            legacy.join("workspaces").join("kystudy.sqlite3"),
            b"fixture",
        )
        .expect("legacy database should be written");

        migrate_legacy_data_directory(&target, &legacy).expect("migration should succeed");

        assert_eq!(
            fs::read(target.join("workspaces").join("kystudy.sqlite3"))
                .expect("migrated database should exist"),
            b"fixture"
        );
        assert!(
            root.path()
                .join("legacy")
                .parent()
                .expect("legacy parent should exist")
                .read_dir()
                .expect("backup directory should be readable")
                .any(|entry| entry
                    .expect("backup entry should be readable")
                    .file_name()
                    .to_string_lossy()
                    .starts_with("legacy.backup-"))
        );

        migrate_legacy_data_directory(&target, &legacy)
            .expect("verified migration should be idempotent");
    }

    #[test]
    fn legacy_workspace_migration_ignores_the_installer_data_marker() {
        let root = tempfile::tempdir().expect("temporary root should be created");
        let legacy = root.path().join("legacy");
        let target = root.path().join("install").join("data");
        fs::create_dir_all(legacy.join("workspaces")).expect("legacy workspace should be created");
        fs::create_dir_all(&target).expect("installer data directory should be created");
        fs::write(
            target.join(DATA_DIRECTORY_MARKER),
            b"KyStudy user data directory v1",
        )
        .expect("installer marker should be written");
        fs::write(
            legacy.join("workspaces").join("kystudy.sqlite3"),
            b"fixture",
        )
        .expect("legacy database should be written");

        migrate_legacy_data_directory(&target, &legacy)
            .expect("migration should allow the installer marker");

        assert!(target.join(DATA_DIRECTORY_MARKER).exists());
        assert!(target.join("workspaces").join("kystudy.sqlite3").exists());
    }
}
