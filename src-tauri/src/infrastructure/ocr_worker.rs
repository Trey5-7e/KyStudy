use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;
use sha2::Digest;
use tempfile::Builder;
use uuid::Uuid;
use zip::ZipArchive;

use crate::application::{
    OCR_ENGINE_NAME, OcrComponentDownloader, OcrComponentManager, OcrComponentState,
    OcrComponentStatus, OcrEngine, OcrEngineLine, OcrEngineOutput, OcrError, OcrPackageOption,
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
const MAX_DOWNLOAD_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES: u64 = 4 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, Copy)]
struct OcrPackageManifest {
    version_id: &'static str,
    label: &'static str,
    description: &'static str,
    download_size_bytes: u64,
    installed_size_bytes: u64,
    is_recommended: bool,
    url: &'static str,
    sha256: &'static str,
}

const OFFICIAL_OCR_PACKAGES: &[OcrPackageManifest] = &[
    OcrPackageManifest {
        version_id: "v0.1.4",
        label: "v0.1.4 增强版",
        description: "包含图像增强预处理与公式识别支持，识别精度更高",
        download_size_bytes: 763_654_968,
        installed_size_bytes: 1_489_569_055,
        is_recommended: true,
        url: "https://github.com/Trey5-7e/KyStudy/releases/download/ocr-v0.1.4/kystudy-ocr-worker-v0.1.4.zip",
        sha256: "3d339393de86f7759dc764fb844d97761e4ddf8354dd2330b71eb1a765c3fe6f",
    },
    OcrPackageManifest {
        version_id: "v0.1.0",
        label: "v0.1.0 轻量版",
        description: "仅包含基础文字识别模型，体积小巧，下载更迅速",
        download_size_bytes: 116_300_551,
        installed_size_bytes: 270_532_608,
        is_recommended: false,
        url: "https://github.com/Trey5-7e/KyStudy/releases/download/ocr-v0.1.0/kystudy-ocr-worker-v0.1.0.zip",
        sha256: "bb5a3e16a898713adde85717f4debe8cfbdf22cae10eb632752368f200513b01",
    },
];

#[derive(Debug, Clone, Copy)]
struct OcrDownloadManifest {
    url: &'static str,
    sha256: &'static str,
}

// Allows overriding via build-time environment variables, or falls back to official release asset.
const OCR_DOWNLOAD_URL: Option<&str> = option_env!("KYSTUDY_OCR_DOWNLOAD_URL");
const OCR_DOWNLOAD_SHA256: Option<&str> = option_env!("KYSTUDY_OCR_DOWNLOAD_SHA256");

fn ocr_download_manifest_for(version: Option<&str>) -> Option<OcrDownloadManifest> {
    if let (Some(url), Some(sha256)) = (OCR_DOWNLOAD_URL, OCR_DOWNLOAD_SHA256)
        && valid_download_url(url)
        && valid_sha256(sha256)
    {
        return Some(OcrDownloadManifest { url, sha256 });
    }
    let target = version.unwrap_or("v0.1.4").trim();
    let package = if target.is_empty()
        || target.eq_ignore_ascii_case("v0.1.4")
        || target.eq_ignore_ascii_case("ocr-v0.1.4")
    {
        OFFICIAL_OCR_PACKAGES
            .iter()
            .find(|p| p.version_id == "v0.1.4")
    } else if target.eq_ignore_ascii_case("v0.1.0") || target.eq_ignore_ascii_case("ocr-v0.1.0") {
        OFFICIAL_OCR_PACKAGES
            .iter()
            .find(|p| p.version_id == "v0.1.0")
    } else {
        None
    }?;
    if valid_download_url(package.url) && valid_sha256(package.sha256) {
        Some(OcrDownloadManifest {
            url: package.url,
            sha256: package.sha256,
        })
    } else {
        None
    }
}

fn valid_download_url(value: &str) -> bool {
    reqwest::Url::parse(value).is_ok_and(|url| url.scheme() == "https")
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

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

    #[cfg(debug_assertions)]
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
        // Keep the repository-local worker convenient for `tauri dev`, but never
        // let a Release build report an unmanaged development component.
        #[cfg(debug_assertions)]
        {
            let development = Self::development_component_root();
            if development.exists() {
                return development;
            }
        }
        managed
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

impl OcrComponentManager for LocalOcrWorker {
    fn install_component(&self, source: &Path) -> Result<OcrComponentStatus, OcrError> {
        let source = fs::canonicalize(source).map_err(|_| OcrError::ComponentSourceInvalid)?;
        let managed = self.managed_component_root();
        if !source.is_dir()
            || (managed.exists()
                && fs::canonicalize(&managed).is_ok_and(|managed| managed == source))
        {
            return Err(OcrError::ComponentSourceInvalid);
        }
        validate_component_tree(&source)?;

        let parent = self
            .managed_component_root()
            .parent()
            .map(Path::to_owned)
            .ok_or(OcrError::ComponentInstallFailed)?;
        fs::create_dir_all(&parent).map_err(|_| OcrError::ComponentInstallFailed)?;
        let temporary = parent.join(format!(".kystudy-ocr-install-{}", Uuid::now_v7()));
        if let Err(error) = copy_component_tree(&source, &temporary) {
            let _ = fs::remove_dir_all(&temporary);
            return Err(error);
        }

        let previous = parent.join(format!(".kystudy-ocr-previous-{}", Uuid::now_v7()));
        let had_previous = managed.exists();
        if had_previous {
            fs::rename(&managed, &previous).map_err(|_| {
                let _ = fs::remove_dir_all(&temporary);
                OcrError::ComponentInstallFailed
            })?;
        }
        if fs::rename(&temporary, &managed).is_err() {
            let _ = fs::remove_dir_all(&temporary);
            if had_previous {
                let _ = fs::rename(&previous, &managed);
            }
            return Err(OcrError::ComponentInstallFailed);
        }
        if had_previous {
            fs::remove_dir_all(&previous).map_err(|_| OcrError::ComponentInstallFailed)?;
        }
        Ok(self.status())
    }

    fn remove_component(&self) -> Result<OcrComponentStatus, OcrError> {
        let managed = self.managed_component_root();
        if managed.exists() {
            fs::remove_dir_all(managed).map_err(|_| OcrError::ComponentRemovalFailed)?;
        }
        Ok(self.status())
    }
}

impl OcrComponentDownloader for LocalOcrWorker {
    fn download_available(&self) -> bool {
        ocr_download_manifest_for(None).is_some()
    }

    fn download_packages(&self) -> Vec<OcrPackageOption> {
        OFFICIAL_OCR_PACKAGES
            .iter()
            .map(|pkg| OcrPackageOption {
                version_id: pkg.version_id,
                label: pkg.label,
                description: pkg.description,
                download_size_bytes: pkg.download_size_bytes,
                installed_size_bytes: pkg.installed_size_bytes,
                is_recommended: pkg.is_recommended,
            })
            .collect()
    }

    fn download_component(
        &self,
        version: Option<&str>,
        canceled: &AtomicBool,
        observe: &mut dyn FnMut(u64, u64),
    ) -> Result<OcrComponentStatus, OcrError> {
        let Some(manifest) = ocr_download_manifest_for(version) else {
            return Err(OcrError::ComponentDownloadUnavailable);
        };
        let cache_directory = self.application_data_directory.join("cache").join("ocr");
        fs::create_dir_all(&cache_directory).map_err(|_| OcrError::ComponentDownloadFailed)?;
        let archive_path = cache_directory.join(format!("download-{}.zip", Uuid::now_v7()));
        let result = download_archive(manifest, &archive_path, canceled, observe).and_then(|()| {
            let (source, extraction_root) =
                extract_component_archive(&archive_path, &cache_directory, canceled)?;
            let install_result = self.install_component(&source);
            let _ = fs::remove_dir_all(extraction_root);
            install_result
        });
        let _ = fs::remove_file(&archive_path);
        result
    }
}

fn download_archive(
    manifest: OcrDownloadManifest,
    archive_path: &Path,
    canceled: &AtomicBool,
    observe: &mut dyn FnMut(u64, u64),
) -> Result<(), OcrError> {
    let url =
        reqwest::Url::parse(manifest.url).map_err(|_| OcrError::ComponentDownloadUnavailable)?;
    if url.scheme() != "https" {
        return Err(OcrError::ComponentDownloadUnavailable);
    }
    let client = reqwest::blocking::Client::builder()
        .user_agent("KyStudy-Desktop/0.1.4")
        .https_only(true)
        .connect_timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|_| OcrError::ComponentDownloadFailed)?;
    let mut response = client
        .get(url)
        .send()
        .map_err(|_| OcrError::ComponentDownloadFailed)?;
    if !response.status().is_success() {
        return Err(OcrError::ComponentDownloadFailed);
    }
    let total = response.content_length().unwrap_or(0);
    if total > MAX_DOWNLOAD_BYTES {
        return Err(OcrError::ComponentDownloadFailed);
    }
    let mut output =
        fs::File::create(archive_path).map_err(|_| OcrError::ComponentDownloadFailed)?;
    let mut hasher = sha2::Sha256::new();
    let mut copied = 0_u64;
    let mut buffer = vec![0_u8; 64 * 1024].into_boxed_slice();
    loop {
        if canceled.load(Ordering::Relaxed) {
            return Err(OcrError::Canceled);
        }
        let read = response
            .read(&mut buffer)
            .map_err(|_| OcrError::ComponentDownloadFailed)?;
        if read == 0 {
            break;
        }
        copied = copied
            .checked_add(u64::try_from(read).map_err(|_| OcrError::ComponentDownloadFailed)?)
            .ok_or(OcrError::ComponentDownloadFailed)?;
        if copied > MAX_DOWNLOAD_BYTES {
            return Err(OcrError::ComponentDownloadFailed);
        }
        output
            .write_all(&buffer[..read])
            .map_err(|_| OcrError::ComponentDownloadFailed)?;
        hasher.update(&buffer[..read]);
        observe(copied, total);
    }
    output
        .sync_all()
        .map_err(|_| OcrError::ComponentDownloadFailed)?;
    let actual = format!("{:x}", hasher.finalize());
    if !actual.eq_ignore_ascii_case(manifest.sha256) {
        return Err(OcrError::ComponentDownloadIntegrity);
    }
    Ok(())
}

fn extract_component_archive(
    archive_path: &Path,
    temporary_parent: &Path,
    canceled: &AtomicBool,
) -> Result<(PathBuf, PathBuf), OcrError> {
    let file = fs::File::open(archive_path).map_err(|_| OcrError::ComponentArchiveInvalid)?;
    let mut archive = ZipArchive::new(file).map_err(|_| OcrError::ComponentArchiveInvalid)?;
    let extraction_root = temporary_parent.join(format!("extract-{}", Uuid::now_v7()));
    fs::create_dir_all(&extraction_root).map_err(|_| OcrError::ComponentArchiveInvalid)?;
    let result = (|| {
        let mut uncompressed_bytes = 0_u64;
        for index in 0..archive.len() {
            if canceled.load(Ordering::Relaxed) {
                return Err(OcrError::Canceled);
            }
            let mut entry = archive
                .by_index(index)
                .map_err(|_| OcrError::ComponentArchiveInvalid)?;
            uncompressed_bytes = uncompressed_bytes
                .checked_add(entry.size())
                .ok_or(OcrError::ComponentArchiveInvalid)?;
            if uncompressed_bytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES {
                return Err(OcrError::ComponentArchiveInvalid);
            }
            if entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170_000 == 0o120_000)
            {
                return Err(OcrError::ComponentArchiveInvalid);
            }
            let relative = entry
                .enclosed_name()
                .ok_or(OcrError::ComponentArchiveInvalid)?;
            let destination = extraction_root.join(relative);
            if entry.is_dir() {
                fs::create_dir_all(&destination).map_err(|_| OcrError::ComponentArchiveInvalid)?;
            } else {
                if let Some(parent) = destination.parent() {
                    fs::create_dir_all(parent).map_err(|_| OcrError::ComponentArchiveInvalid)?;
                }
                let mut output = fs::File::create(&destination)
                    .map_err(|_| OcrError::ComponentArchiveInvalid)?;
                std::io::copy(&mut entry, &mut output)
                    .map_err(|_| OcrError::ComponentArchiveInvalid)?;
            }
        }
        let source = extraction_root.join("kystudy-ocr-worker");
        validate_component_tree(&source).map_err(|_| OcrError::ComponentArchiveInvalid)?;
        Ok((source, extraction_root.clone()))
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&extraction_root);
    }
    result
}

fn validate_component_tree(root: &Path) -> Result<(), OcrError> {
    for relative in REQUIRED_COMPONENT_FILES {
        let path = root.join(relative);
        let metadata = fs::symlink_metadata(path).map_err(|_| OcrError::ComponentSourceInvalid)?;
        if !metadata.file_type().is_file() {
            return Err(OcrError::ComponentSourceInvalid);
        }
    }
    Ok(())
}

fn copy_component_tree(source: &Path, destination: &Path) -> Result<(), OcrError> {
    fs::create_dir(destination).map_err(|_| OcrError::ComponentInstallFailed)?;
    for entry in fs::read_dir(source).map_err(|_| OcrError::ComponentInstallFailed)? {
        let entry = entry.map_err(|_| OcrError::ComponentInstallFailed)?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let metadata =
            fs::symlink_metadata(&source_path).map_err(|_| OcrError::ComponentInstallFailed)?;
        if metadata.file_type().is_symlink() {
            let _ = fs::remove_dir_all(destination);
            return Err(OcrError::ComponentSourceInvalid);
        }
        if metadata.file_type().is_dir() {
            copy_component_tree(&source_path, &destination_path)?;
        } else if metadata.file_type().is_file() {
            fs::copy(&source_path, &destination_path)
                .map_err(|_| OcrError::ComponentInstallFailed)?;
        } else {
            let _ = fs::remove_dir_all(destination);
            return Err(OcrError::ComponentSourceInvalid);
        }
    }
    Ok(())
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
    preprocess: Option<WorkerPreprocess>,
    lines: Vec<WorkerLine>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkerPreprocess {
    upscaled: bool,
    inverted: bool,
    grayscale: bool,
    formula_enhanced: Option<bool>,
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
            if let Some(preprocess) = success.preprocess {
                let _ = (
                    preprocess.upscaled,
                    preprocess.inverted,
                    preprocess.grayscale,
                    preprocess.formula_enhanced,
                );
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
    use std::fs;

    use super::*;
    use tempfile::tempdir;

    fn component_fixture(root: &Path) {
        for relative in REQUIRED_COMPONENT_FILES {
            let path = root.join(relative);
            fs::create_dir_all(path.parent().expect("fixture file should have a parent"))
                .expect("fixture directory should be created");
            fs::write(path, b"fixture").expect("fixture file should be written");
        }
    }

    #[test]
    fn parser_accepts_the_stable_worker_schema() {
        let output = parse_worker_response(
            r#"{"schemaVersion":1,"engine":"rapidocr-3.9.2-ppocrv6-small-onnx-cpu","width":100,"height":200,"elapsedMs":12.5,"preprocess":{"upscaled":false,"inverted":false,"grayscale":true},"lines":[{"text":"数据结构","confidence":0.98,"box":{"x":0.1,"y":0.2,"width":0.5,"height":0.1}}]}"#,
        )
        .expect("stable worker response should parse");

        assert_eq!(output.lines.len(), 1);
        assert_eq!(output.lines[0].text, "数据结构");
    }

    #[test]
    fn parser_accepts_optional_formula_enhancement_marker() {
        let output = parse_worker_response(
            r#"{"schemaVersion":1,"engine":"rapidocr-3.9.2-ppocrv6-small-onnx-cpu","width":100,"height":200,"elapsedMs":12.5,"preprocess":{"upscaled":true,"inverted":false,"grayscale":true,"formulaEnhanced":true},"lines":[{"text":"lim","confidence":0.9,"box":{"x":0.1,"y":0.2,"width":0.5,"height":0.1}}]}"#,
        )
        .expect("formula-enhanced worker response should parse");

        assert_eq!(output.lines[0].text, "lim");
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

    #[test]
    fn component_install_validates_and_replaces_managed_directory_atomically() {
        let application_data = tempdir().expect("application data should exist");
        let source = tempdir().expect("component source should exist");
        component_fixture(source.path());
        let worker = LocalOcrWorker::new(application_data.path());

        let status = worker
            .install_component(source.path())
            .expect("complete component should install");
        assert_eq!(status.state, OcrComponentState::Available);
        assert!(worker.managed_component_root().is_dir());

        let replacement = tempdir().expect("replacement source should exist");
        component_fixture(replacement.path());
        fs::write(
            replacement.path().join("kystudy-ocr-worker.exe"),
            b"replacement",
        )
        .expect("replacement marker should be written");
        worker
            .install_component(replacement.path())
            .expect("replacement component should install");
        assert_eq!(
            fs::read(
                worker
                    .managed_component_root()
                    .join("kystudy-ocr-worker.exe")
            )
            .expect("installed executable marker should be readable"),
            b"replacement"
        );
    }

    #[test]
    fn component_install_rejects_incomplete_source_and_remove_cleans_managed_copy() {
        let application_data = tempdir().expect("application data should exist");
        let source = tempdir().expect("component source should exist");
        fs::write(source.path().join("kystudy-ocr-worker.exe"), b"partial")
            .expect("partial marker should be written");
        let worker = LocalOcrWorker::new(application_data.path());

        assert!(matches!(
            worker.install_component(source.path()),
            Err(OcrError::ComponentSourceInvalid)
        ));

        let complete = tempdir().expect("complete source should exist");
        component_fixture(complete.path());
        worker
            .install_component(complete.path())
            .expect("complete component should install");
        worker
            .remove_component()
            .expect("managed component should be removable");
        assert!(!worker.managed_component_root().exists());
    }

    #[test]
    fn download_configuration_accepts_only_https_and_a_sha256_digest() {
        assert!(valid_download_url("https://example.com/ocr.zip"));
        assert!(!valid_download_url("http://example.com/ocr.zip"));
        assert!(!valid_download_url("not-a-url"));
        assert!(valid_sha256(&"a".repeat(64)));
        assert!(valid_sha256(&"A1".repeat(32)));
        assert!(!valid_sha256("short"));
        assert!(!valid_sha256(&"g".repeat(64)));
    }

    #[test]
    fn compile_time_download_configuration_defaults_to_official_release() {
        let manifest_default =
            ocr_download_manifest_for(None).expect("manifest should be available by default");
        assert!(valid_download_url(manifest_default.url));
        assert!(valid_sha256(manifest_default.sha256));
        assert!(manifest_default.url.contains("ocr-v0.1.4"));

        let manifest_v010 =
            ocr_download_manifest_for(Some("v0.1.0")).expect("v0.1.0 manifest should be available");
        assert!(valid_download_url(manifest_v010.url));
        assert!(valid_sha256(manifest_v010.sha256));
        assert!(manifest_v010.url.contains("ocr-v0.1.0"));
    }
}
