//! Disposable Tauri boundary experiment for KyStudy TV-01.
//!
//! The crate verifies typed commands, stable UI errors, constrained file access,
//! and progress-event cleanup before the formal KyStudy application is created.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::File,
    io::{BufReader, Read},
    path::Path,
    sync::Mutex,
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::{DialogExt, FilePath};
use uuid::Uuid;

const MAX_UNTRUSTED_PATH_BYTES: usize = 4_096;
const HASH_BUFFER_BYTES: usize = 64 * 1_024;
const PROGRESS_EVENT: &str = "tv01-progress";
const PROGRESS_STEP_DELAY: Duration = Duration::from_millis(500);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppError {
    code: String,
    message: String,
    action: Option<String>,
    operation_id: String,
}

impl AppError {
    fn new(code: &str, message: &str, action: Option<&str>, operation_id: String) -> Self {
        Self {
            code: code.to_owned(),
            message: message.to_owned(),
            action: action.map(str::to_owned),
            operation_id,
        }
    }

    fn internal(operation_id: String) -> Self {
        Self::new(
            "INTERNAL_ERROR",
            "本地操作未能完成。",
            Some("请重试；若问题持续，请记录操作编号。"),
            operation_id,
        )
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EnvironmentStatus {
    app_version: String,
    platform: String,
    arch: String,
    app_data_ready: bool,
    operation_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileFingerprint {
    file_name: String,
    size_bytes: u64,
    sha256: String,
    operation_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OperationStarted {
    operation_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    operation_id: String,
    percent: u8,
    stage: String,
    done: bool,
    cancelled: bool,
}

#[derive(Default)]
struct ProgressState {
    cancelled: Mutex<HashSet<String>>,
}

fn new_operation_id() -> String {
    Uuid::new_v4().to_string()
}

#[tauri::command]
fn get_environment_status(app: AppHandle) -> EnvironmentStatus {
    let app_data_ready = app
        .path()
        .app_data_dir()
        .and_then(|path| std::fs::create_dir_all(path).map_err(Into::into))
        .is_ok();

    EnvironmentStatus {
        app_version: app.package_info().version.to_string(),
        platform: std::env::consts::OS.to_owned(),
        arch: std::env::consts::ARCH.to_owned(),
        app_data_ready,
        operation_id: new_operation_id(),
    }
}

#[tauri::command]
fn trigger_expected_failure() -> Result<(), AppError> {
    let operation_id = new_operation_id();
    Err(AppError::new(
        "TV01_EXPECTED_FAILURE",
        "这是 TV-01 主动触发的受控失败。",
        Some("无需修复；该结果用于验证错误边界。"),
        operation_id,
    ))
}

#[tauri::command]
fn probe_untrusted_path(candidate_path: String) -> Result<(), AppError> {
    let operation_id = new_operation_id();

    if candidate_path.len() > MAX_UNTRUSTED_PATH_BYTES {
        return Err(AppError::new(
            "INPUT_TOO_LONG",
            "路径输入超过允许长度。",
            Some("请缩短输入后重试。"),
            operation_id,
        ));
    }

    Err(AppError::new(
        "PERMISSION_PATH_NOT_GRANTED",
        "前端提供的路径没有读取授权。",
        Some("请使用原生文件选择按钮，由 Rust 在单次操作内读取元数据。"),
        operation_id,
    ))
}

#[tauri::command]
async fn select_file_fingerprint(app: AppHandle) -> Result<FileFingerprint, AppError> {
    let operation_id = new_operation_id();
    let selected = app
        .dialog()
        .file()
        .add_filter("公开测试文本", &["txt", "md"])
        .blocking_pick_file()
        .ok_or_else(|| {
            AppError::new(
                "FILE_SELECTION_CANCELLED",
                "没有选择文件。",
                Some("可以重新打开文件选择器。"),
                operation_id.clone(),
            )
        })?;

    let path = match selected {
        FilePath::Path(path) => path,
        FilePath::Url(_) => {
            return Err(AppError::new(
                "FILE_URL_NOT_SUPPORTED",
                "TV-01 只接受本地文件。",
                Some("请选择本机上的文本文件。"),
                operation_id,
            ));
        }
    };

    let fingerprint_operation_id = operation_id.clone();
    tauri::async_runtime::spawn_blocking(move || fingerprint_file(&path, fingerprint_operation_id))
        .await
        .map_err(|_| AppError::internal(operation_id))?
}

fn fingerprint_file(path: &Path, operation_id: String) -> Result<FileFingerprint, AppError> {
    let file = File::open(path).map_err(|_| {
        AppError::new(
            "FILE_OPEN_FAILED",
            "选择的文件无法打开。",
            Some("请确认文件仍然存在且当前账户有读取权限。"),
            operation_id.clone(),
        )
    })?;
    let size_bytes = file
        .metadata()
        .map_err(|_| AppError::internal(operation_id.clone()))?
        .len();
    let mut reader = BufReader::with_capacity(HASH_BUFFER_BYTES, file);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; HASH_BUFFER_BYTES];

    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|_| AppError::internal(operation_id.clone()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("未命名文件")
        .to_owned();

    Ok(FileFingerprint {
        file_name,
        size_bytes,
        sha256: format!("{:x}", hasher.finalize()),
        operation_id,
    })
}

#[tauri::command]
fn start_progress_demo(app: AppHandle) -> Result<OperationStarted, AppError> {
    let operation_id = new_operation_id();
    let thread_operation_id = operation_id.clone();

    thread::spawn(move || {
        for percent in (0_u8..=100).step_by(10) {
            let cancelled = app
                .state::<ProgressState>()
                .cancelled
                .lock()
                .map(|state| state.contains(&thread_operation_id))
                .unwrap_or(true);

            let done = cancelled || percent == 100;
            let stage = if cancelled {
                "已取消"
            } else if done {
                "已完成"
            } else {
                "验证事件边界"
            };

            let _ = app.emit(
                PROGRESS_EVENT,
                ProgressEvent {
                    operation_id: thread_operation_id.clone(),
                    percent,
                    stage: stage.to_owned(),
                    done,
                    cancelled,
                },
            );

            if done {
                if let Ok(mut state) = app.state::<ProgressState>().cancelled.lock() {
                    state.remove(&thread_operation_id);
                }
                break;
            }

            thread::sleep(PROGRESS_STEP_DELAY);
        }
    });

    Ok(OperationStarted { operation_id })
}

#[tauri::command]
fn cancel_progress_demo(
    operation_id: String,
    state: State<'_, ProgressState>,
) -> Result<(), AppError> {
    let error_operation_id = new_operation_id();
    if operation_id.is_empty() || operation_id.len() > 64 {
        return Err(AppError::new(
            "INVALID_OPERATION_ID",
            "任务编号格式无效。",
            None,
            error_operation_id,
        ));
    }

    state
        .cancelled
        .lock()
        .map_err(|_| AppError::internal(error_operation_id))?
        .insert(operation_id);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// Starts the disposable TV-01 desktop experiment.
///
/// A startup failure is unrecoverable because no application window exists yet.
pub fn run() {
    tauri::Builder::default()
        .manage(ProgressState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_environment_status,
            trigger_expected_failure,
            probe_untrusted_path,
            select_file_fingerprint,
            start_progress_demo,
            cancel_progress_demo
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn untrusted_paths_are_never_read() {
        let error = probe_untrusted_path("..\\..\\private\\notes.txt".to_owned()).unwrap_err();
        assert_eq!(error.code, "PERMISSION_PATH_NOT_GRANTED");
    }

    #[test]
    fn expected_failure_uses_the_stable_error_contract() {
        let error = trigger_expected_failure().unwrap_err();
        assert_eq!(
            (
                error.code.as_str(),
                error.action.is_some(),
                error.operation_id.len()
            ),
            ("TV01_EXPECTED_FAILURE", true, 36)
        );
    }

    #[test]
    fn oversized_path_input_is_rejected_before_use() {
        let error = probe_untrusted_path("x".repeat(MAX_UNTRUSTED_PATH_BYTES + 1)).unwrap_err();
        assert_eq!(error.code, "INPUT_TOO_LONG");
    }

    #[test]
    fn fingerprints_unicode_file_names_without_loading_the_whole_file() {
        let path =
            std::env::temp_dir().join(format!("KyStudy 中文 sample-{}.txt", new_operation_id()));
        std::fs::write(&path, b"abc").expect("test fixture should be writable");

        let result = fingerprint_file(&path, new_operation_id());
        std::fs::remove_file(&path).expect("test fixture should be removable");
        let fingerprint = result.expect("fixture should be fingerprinted");

        assert_eq!(
            (
                fingerprint.size_bytes,
                fingerprint.file_name.starts_with("KyStudy 中文 sample-"),
                fingerprint.sha256.as_str()
            ),
            (
                3,
                true,
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
            )
        );
    }
}
