use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tempfile::Builder;

use crate::application::{
    OCR_ENGINE_NAME, OcrComponentState, OcrComponentStatus, OcrEngine, OcrEngineLine,
    OcrEngineOutput, OcrError,
};

const POLL_INTERVAL: Duration = Duration::from_millis(25);
const WORKER_TIMEOUT: Duration = Duration::from_secs(90);
const MAX_OUTPUT_BYTES: u64 = 2 * 1024 * 1024;
const REQUIRED_COMPONENT_FILES: &[&str] = &[
    "kystudy-ocr-worker.exe",
    "_internal/rapidocr/models/PP-OCRv6_det_small.onnx",
    "_internal/rapidocr/models/PP-OCRv6_rec_small.onnx",
    "_internal/rapidocr/models/ch_ppocr_mobile_v2.0_cls_mobile.onnx",
    "_internal/onnxruntime/capi/onnxruntime_pybind11_state.pyd",
];

/// Launches the optional OCR component without exposing its managed path.
#[derive(Debug, Clone)]
pub(crate) struct LocalOcrWorker {
    application_data_directory: PathBuf,
}

impl LocalOcrWorker {
    pub(crate) fn new(application_data_directory: &Path) -> Self {
        Self {
            application_data_directory: application_data_directory.to_owned(),
        }
    }

    fn managed_component_root(&self) -> PathBuf {
        self.application_data_directory
            .join("components")
            .join("ocr")
            .join("kystudy-ocr-worker")
    }

    fn development_component_root() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("experiments")
            .join("tv-07-ocr")
            .join("output")
            .join("pyinstaller")
            .join("dist")
            .join("kystudy-ocr-worker")
    }

    fn component_root(&self) -> PathBuf {
        let managed = self.managed_component_root();
        if managed.exists() {
            return managed;
        }
        let development = Self::development_component_root();
        if development.exists() {
            development
        } else {
            managed
        }
    }
}

impl OcrEngine for LocalOcrWorker {
    fn status(&self) -> OcrComponentStatus {
        let root = self.component_root();
        if !root.exists() {
            return OcrComponentStatus {
                state: OcrComponentState::Missing,
                engine: OCR_ENGINE_NAME,
                models_bundled: false,
                component_size_bytes: None,
            };
        }
        let complete = REQUIRED_COMPONENT_FILES
            .iter()
            .all(|relative| root.join(relative).is_file());
        OcrComponentStatus {
            state: if complete {
                OcrComponentState::Available
            } else {
                OcrComponentState::Incomplete
            },
            engine: OCR_ENGINE_NAME,
            models_bundled: complete,
            component_size_bytes: directory_size(&root).ok(),
        }
    }

    fn recognize(
        &self,
        image_bytes: &[u8],
        canceled: &AtomicBool,
    ) -> Result<OcrEngineOutput, OcrError> {
        let root = self.component_root();
        match self.status().state {
            OcrComponentState::Missing => return Err(OcrError::ComponentMissing),
            OcrComponentState::Incomplete => return Err(OcrError::ComponentIncomplete),
            OcrComponentState::Available => {}
        }
        let cache_directory = self.application_data_directory.join("cache").join("ocr");
        fs::create_dir_all(&cache_directory).map_err(storage_error)?;
        let mut image_file = Builder::new()
            .prefix("region-")
            .suffix(".png")
            .tempfile_in(&cache_directory)
            .map_err(storage_error)?;
        image_file.write_all(image_bytes).map_err(storage_error)?;
        image_file.flush().map_err(storage_error)?;
        let output_file = Builder::new()
            .prefix("result-")
            .suffix(".json")
            .tempfile_in(&cache_directory)
            .map_err(storage_error)?;
        let output_handle = output_file.reopen().map_err(storage_error)?;

        let mut command = Command::new(root.join("kystudy-ocr-worker.exe"));
        command
            .arg("once")
            .arg(image_file.path())
            .stdin(Stdio::null())
            .stdout(Stdio::from(output_handle))
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;

            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = command.spawn().map_err(|_| OcrError::WorkerFailed)?;
        let status = wait_for_worker(&mut child, canceled)?;
        if !status.success() {
            return Err(OcrError::WorkerFailed);
        }
        let output_metadata = output_file.as_file().metadata().map_err(storage_error)?;
        if output_metadata.len() == 0 || output_metadata.len() > MAX_OUTPUT_BYTES {
            return Err(OcrError::ResultInvalid);
        }
        let output = fs::read_to_string(output_file.path()).map_err(storage_error)?;
        parse_worker_response(&output)
    }
}

fn wait_for_worker(child: &mut Child, canceled: &AtomicBool) -> Result<ExitStatus, OcrError> {
    let started = Instant::now();
    loop {
        if canceled.load(Ordering::Relaxed) {
            stop_worker(child);
            return Err(OcrError::Canceled);
        }
        if started.elapsed() >= WORKER_TIMEOUT {
            stop_worker(child);
            return Err(OcrError::Timeout);
        }
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) => {}
            Err(_) => {
                stop_worker(child);
                return Err(OcrError::WorkerFailed);
            }
        }
        thread::sleep(POLL_INTERVAL);
    }
}

fn stop_worker(child: &mut Child) {
    if matches!(child.try_wait(), Ok(Some(_))) {
        return;
    }
    let _ = child.kill();
    let _ = child.wait();
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum WorkerResponse {
    Success(WorkerSuccess),
    Failure(WorkerFailure),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkerSuccess {
    schema_version: u32,
    engine: String,
    width: u32,
    height: u32,
    elapsed_ms: f64,
    lines: Vec<WorkerLine>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkerFailure {
    schema_version: u32,
    error: WorkerError,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkerError {
    code: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkerLine {
    text: String,
    confidence: f64,
    #[serde(rename = "box")]
    box_: WorkerBox,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkerBox {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

fn parse_worker_response(value: &str) -> Result<OcrEngineOutput, OcrError> {
    match serde_json::from_str::<WorkerResponse>(value).map_err(|_| OcrError::ResultInvalid)? {
        WorkerResponse::Failure(failure) => {
            if failure.schema_version != 1 {
                return Err(OcrError::ComponentIncompatible);
            }
            match failure.error.code.as_str() {
                "OCR_INPUT_UNSUPPORTED" | "OCR_INPUT_TOO_LARGE" | "OCR_INPUT_INVALID" => {
                    Err(OcrError::InvalidInput)
                }
                "OCR_WORKER_FAILED" | "OCR_ENGINE_FAILED" => Err(OcrError::WorkerFailed),
                _ => Err(OcrError::ResultInvalid),
            }
        }
        WorkerResponse::Success(success) => {
            if success.schema_version != 1 || success.engine != OCR_ENGINE_NAME {
                return Err(OcrError::ComponentIncompatible);
            }
            if success.width == 0
                || success.height == 0
                || !success.elapsed_ms.is_finite()
                || success.elapsed_ms < 0.0
            {
                return Err(OcrError::ResultInvalid);
            }
            Ok(OcrEngineOutput {
                engine: success.engine,
                lines: success
                    .lines
                    .into_iter()
                    .map(|line| OcrEngineLine {
                        text: line.text,
                        confidence: line.confidence,
                        x: line.box_.x,
                        y: line.box_.y,
                        width: line.box_.width,
                        height: line.box_.height,
                    })
                    .collect(),
            })
        }
    }
}

fn directory_size(path: &Path) -> std::io::Result<u64> {
    let mut total = 0_u64;
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_file() {
            total = total.saturating_add(entry.metadata()?.len());
        } else if file_type.is_dir() {
            total = total.saturating_add(directory_size(&entry.path())?);
        }
    }
    Ok(total)
}

fn storage_error(_: std::io::Error) -> OcrError {
    OcrError::WorkerFailed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parser_accepts_the_stable_worker_schema() {
        let output = parse_worker_response(
            r#"{"schemaVersion":1,"engine":"rapidocr-3.9.2-ppocrv6-small-onnx-cpu","width":100,"height":200,"elapsedMs":12.5,"lines":[{"text":"数据结构","confidence":0.98,"box":{"x":0.1,"y":0.2,"width":0.5,"height":0.1}}]}"#,
        )
        .expect("stable worker response should parse");

        assert_eq!(output.lines.len(), 1);
        assert_eq!(output.lines[0].text, "数据结构");
    }

    #[test]
    fn parser_rejects_an_incompatible_engine() {
        let result = parse_worker_response(
            r#"{"schemaVersion":1,"engine":"unexpected","width":100,"height":200,"elapsedMs":12.5,"lines":[]}"#,
        );

        assert!(matches!(result, Err(OcrError::ComponentIncompatible)));
    }

    #[test]
    fn parser_maps_worker_input_errors_without_raw_details() {
        let result =
            parse_worker_response(r#"{"schemaVersion":1,"error":{"code":"OCR_INPUT_TOO_LARGE"}}"#);

        assert!(matches!(result, Err(OcrError::InvalidInput)));
    }
}
