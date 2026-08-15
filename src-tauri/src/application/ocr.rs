use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use uuid::Uuid;

use super::{PersistenceError, current_utc_millis};
use crate::domain::{OcrRecognition, OcrRecognitionState, OcrTextLine};

pub(crate) const OCR_ENGINE_NAME: &str = "rapidocr-3.9.2-ppocrv6-small-onnx-cpu";
const MAX_IMAGE_BYTES: usize = 12 * 1024 * 1024;
const MAX_LINES: usize = 5_000;
const MAX_LINE_CHARACTERS: usize = 2_000;
const MAX_TEXT_CHARACTERS: usize = 100_000;
const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";

/// Installation state of the optional OCR component.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum OcrComponentState {
    Missing,
    Incomplete,
    Available,
}

impl OcrComponentState {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Missing => "missing",
            Self::Incomplete => "incomplete",
            Self::Available => "available",
        }
    }
}

/// Safe component metadata returned without installation paths.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OcrComponentStatus {
    pub(crate) state: OcrComponentState,
    pub(crate) engine: &'static str,
    pub(crate) models_bundled: bool,
    pub(crate) component_size_bytes: Option<u64>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct OcrEngineLine {
    pub(crate) text: String,
    pub(crate) confidence: f64,
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct OcrEngineOutput {
    pub(crate) engine: String,
    pub(crate) lines: Vec<OcrEngineLine>,
}

/// One page image submitted for ephemeral OCR during PDF question indexing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RecognizePdfPageInput {
    pub(crate) page_number: u32,
    pub(crate) image_bytes: Vec<u8>,
}

/// One normalized text box returned by ephemeral page OCR.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct OcrPageLine {
    pub(crate) text: String,
    pub(crate) confidence: f64,
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
    pub(crate) sort_order: u32,
}

/// Ephemeral OCR output for one PDF page; it is never persisted by this use case.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct OcrPageRecognition {
    pub(crate) page_number: u32,
    pub(crate) engine: String,
    pub(crate) mean_confidence: f64,
    pub(crate) lines: Vec<OcrPageLine>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RecognizeQuestionRegionInput {
    pub(crate) region_id: String,
    pub(crate) image_bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ConfirmQuestionRegionOcrInput {
    pub(crate) recognition_id: String,
    pub(crate) confirmed_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OcrRegionSource {
    pub(crate) question_id: String,
    pub(crate) region_id: String,
    pub(crate) page_number: u32,
}

/// Stable OCR failures that do not expose worker paths or third-party errors.
#[derive(Debug, thiserror::Error)]
pub(crate) enum OcrError {
    #[error("workspace is not initialized")]
    WorkspaceNotInitialized,
    #[error("question region was not found")]
    RegionNotFound,
    #[error("question was not found")]
    QuestionNotFound,
    #[error("OCR recognition was not found")]
    RecognitionNotFound,
    #[error("OCR recognition is not a draft")]
    RecognitionNotDraft,
    #[error("OCR input is invalid")]
    InvalidInput,
    #[error("OCR component is missing")]
    ComponentMissing,
    #[error("OCR component is incomplete")]
    ComponentIncomplete,
    #[error("OCR component is incompatible")]
    ComponentIncompatible,
    #[error("OCR component source is invalid")]
    ComponentSourceInvalid,
    #[error("OCR component installation failed")]
    ComponentInstallFailed,
    #[error("OCR component download is unavailable")]
    ComponentDownloadUnavailable,
    #[error("OCR component download failed")]
    ComponentDownloadFailed,
    #[error("OCR component download integrity check failed")]
    ComponentDownloadIntegrity,
    #[error("OCR component archive is invalid")]
    ComponentArchiveInvalid,
    #[error("OCR component removal failed")]
    ComponentRemovalFailed,
    #[error("OCR operation was canceled")]
    Canceled,
    #[error("OCR operation timed out")]
    Timeout,
    #[error("OCR worker failed")]
    WorkerFailed,
    #[error("OCR result is invalid")]
    ResultInvalid,
    #[error("another OCR operation is already active")]
    OperationConflict,
    #[error(transparent)]
    Persistence(#[from] PersistenceError),
}

impl OcrError {
    pub(crate) const fn code(&self) -> &'static str {
        match self {
            Self::WorkspaceNotInitialized => "WORKSPACE_NOT_INITIALIZED",
            Self::RegionNotFound => "OCR_REGION_NOT_FOUND",
            Self::QuestionNotFound => "OCR_QUESTION_NOT_FOUND",
            Self::RecognitionNotFound => "OCR_RECOGNITION_NOT_FOUND",
            Self::RecognitionNotDraft => "OCR_RECOGNITION_NOT_DRAFT",
            Self::InvalidInput => "OCR_INPUT_INVALID",
            Self::ComponentMissing => "OCR_COMPONENT_MISSING",
            Self::ComponentIncomplete => "OCR_COMPONENT_INCOMPLETE",
            Self::ComponentIncompatible => "OCR_COMPONENT_INCOMPATIBLE",
            Self::ComponentSourceInvalid => "OCR_COMPONENT_SOURCE_INVALID",
            Self::ComponentInstallFailed => "OCR_COMPONENT_INSTALL_FAILED",
            Self::ComponentDownloadUnavailable => "OCR_COMPONENT_DOWNLOAD_UNAVAILABLE",
            Self::ComponentDownloadFailed => "OCR_COMPONENT_DOWNLOAD_FAILED",
            Self::ComponentDownloadIntegrity => "OCR_COMPONENT_DOWNLOAD_INTEGRITY",
            Self::ComponentArchiveInvalid => "OCR_COMPONENT_ARCHIVE_INVALID",
            Self::ComponentRemovalFailed => "OCR_COMPONENT_REMOVAL_FAILED",
            Self::Canceled => "OCR_CANCELED",
            Self::Timeout => "OCR_TIMEOUT",
            Self::WorkerFailed => "OCR_WORKER_FAILED",
            Self::ResultInvalid => "OCR_RESULT_INVALID",
            Self::OperationConflict => "OCR_OPERATION_CONFLICT",
            Self::Persistence(error) => error.code(),
        }
    }
}

pub(crate) trait OcrRepository: Clone + Send + Sync + 'static {
    fn find_active_region(&self, region_id: &str) -> Result<OcrRegionSource, OcrError>;
    fn list_current(&self, question_id: &str) -> Result<Vec<OcrRecognition>, OcrError>;
    fn replace_draft(&self, recognition: OcrRecognition) -> Result<OcrRecognition, OcrError>;
    fn confirm_draft(
        &self,
        recognition_id: &str,
        confirmed_text: &str,
        updated_at: i64,
    ) -> Result<OcrRecognition, OcrError>;
    fn discard_draft(&self, recognition_id: &str) -> Result<(), OcrError>;
}

pub(crate) trait OcrEngine: Clone + Send + Sync + 'static {
    fn status(&self) -> OcrComponentStatus;
    fn recognize(
        &self,
        image_bytes: &[u8],
        canceled: &AtomicBool,
    ) -> Result<OcrEngineOutput, OcrError>;
}

pub(crate) trait OcrComponentManager {
    fn install_component(&self, source: &Path) -> Result<OcrComponentStatus, OcrError>;
    fn remove_component(&self) -> Result<OcrComponentStatus, OcrError>;
}

pub(crate) trait OcrComponentDownloader {
    fn download_available(&self) -> bool;
    fn download_component(
        &self,
        canceled: &AtomicBool,
        observe: &mut dyn FnMut(u64, u64),
    ) -> Result<OcrComponentStatus, OcrError>;
}

#[derive(Debug, Clone)]
pub(crate) struct OcrUseCases<R, E> {
    repository: R,
    engine: E,
}

impl<R: OcrRepository, E: OcrEngine> OcrUseCases<R, E> {
    pub(crate) const fn new(repository: R, engine: E) -> Self {
        Self { repository, engine }
    }

    pub(crate) fn status(&self) -> OcrComponentStatus {
        self.engine.status()
    }

    pub(crate) fn list_for_question(
        &self,
        question_id: &str,
    ) -> Result<Vec<OcrRecognition>, OcrError> {
        validate_id(question_id)?;
        self.repository.list_current(question_id)
    }

    pub(crate) fn recognize_region(
        &self,
        input: &RecognizeQuestionRegionInput,
        canceled: &AtomicBool,
    ) -> Result<OcrRecognition, OcrError> {
        validate_id(&input.region_id)?;
        validate_image(&input.image_bytes)?;
        if canceled.load(Ordering::Relaxed) {
            return Err(OcrError::Canceled);
        }
        let source = self.repository.find_active_region(&input.region_id)?;
        let output = validate_output(self.engine.recognize(&input.image_bytes, canceled)?)?;
        if canceled.load(Ordering::Relaxed) {
            return Err(OcrError::Canceled);
        }
        let now = current_utc_millis()?;
        let recognition_id = Uuid::now_v7().to_string();
        let recognized_text = output
            .lines
            .iter()
            .map(|line| line.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        let line_count = u32::try_from(output.lines.len()).map_err(|_| OcrError::ResultInvalid)?;
        let mean_confidence = if line_count == 0 {
            0.0
        } else {
            output.lines.iter().map(|line| line.confidence).sum::<f64>() / f64::from(line_count)
        };
        let lines = output
            .lines
            .into_iter()
            .enumerate()
            .map(|(index, line)| {
                Ok(OcrTextLine {
                    id: Uuid::now_v7().to_string(),
                    recognition_id: recognition_id.clone(),
                    text: line.text,
                    confidence: line.confidence,
                    x: line.x,
                    y: line.y,
                    width: line.width,
                    height: line.height,
                    sort_order: u32::try_from(index).map_err(|_| OcrError::ResultInvalid)?,
                })
            })
            .collect::<Result<Vec<_>, OcrError>>()?;
        self.repository.replace_draft(OcrRecognition {
            id: recognition_id,
            question_id: source.question_id,
            region_id: source.region_id,
            page_number: source.page_number,
            engine: output.engine,
            recognized_text,
            confirmed_text: None,
            mean_confidence,
            state: OcrRecognitionState::Draft,
            lines,
            created_at: now,
            updated_at: now,
        })
    }

    /// Recognizes one PDF page without writing a draft or changing any index.
    pub(crate) fn recognize_page(
        &self,
        input: &RecognizePdfPageInput,
        canceled: &AtomicBool,
    ) -> Result<OcrPageRecognition, OcrError> {
        if input.page_number == 0 {
            return Err(OcrError::InvalidInput);
        }
        validate_image(&input.image_bytes)?;
        if canceled.load(Ordering::Relaxed) {
            return Err(OcrError::Canceled);
        }
        let output = validate_output(self.engine.recognize(&input.image_bytes, canceled)?)?;
        if canceled.load(Ordering::Relaxed) {
            return Err(OcrError::Canceled);
        }
        let line_count = u32::try_from(output.lines.len()).map_err(|_| OcrError::ResultInvalid)?;
        let mean_confidence = if line_count == 0 {
            0.0
        } else {
            output.lines.iter().map(|line| line.confidence).sum::<f64>() / f64::from(line_count)
        };
        let lines = output
            .lines
            .into_iter()
            .enumerate()
            .map(|(index, line)| {
                Ok(OcrPageLine {
                    text: line.text,
                    confidence: line.confidence,
                    x: line.x,
                    y: line.y,
                    width: line.width,
                    height: line.height,
                    sort_order: u32::try_from(index).map_err(|_| OcrError::ResultInvalid)?,
                })
            })
            .collect::<Result<Vec<_>, OcrError>>()?;
        Ok(OcrPageRecognition {
            page_number: input.page_number,
            engine: output.engine,
            mean_confidence,
            lines,
        })
    }

    pub(crate) fn confirm(
        &self,
        input: &ConfirmQuestionRegionOcrInput,
    ) -> Result<OcrRecognition, OcrError> {
        validate_id(&input.recognition_id)?;
        let confirmed_text = required_text(&input.confirmed_text, MAX_TEXT_CHARACTERS)?;
        self.repository.confirm_draft(
            &input.recognition_id,
            &confirmed_text,
            current_utc_millis()?,
        )
    }

    pub(crate) fn discard(&self, recognition_id: &str) -> Result<(), OcrError> {
        validate_id(recognition_id)?;
        self.repository.discard_draft(recognition_id)
    }
}

impl<R: OcrRepository, E: OcrEngine + OcrComponentManager> OcrUseCases<R, E> {
    pub(crate) fn install_component(&self, source: &Path) -> Result<OcrComponentStatus, OcrError> {
        self.engine.install_component(source)
    }

    pub(crate) fn remove_component(&self) -> Result<OcrComponentStatus, OcrError> {
        self.engine.remove_component()
    }
}

impl<R: OcrRepository, E: OcrEngine + OcrComponentDownloader> OcrUseCases<R, E> {
    pub(crate) fn download_available(&self) -> bool {
        self.engine.download_available()
    }

    pub(crate) fn download_component(
        &self,
        canceled: &AtomicBool,
        observe: &mut dyn FnMut(u64, u64),
    ) -> Result<OcrComponentStatus, OcrError> {
        self.engine.download_component(canceled, observe)
    }
}

fn validate_image(image_bytes: &[u8]) -> Result<(), OcrError> {
    if image_bytes.len() < PNG_SIGNATURE.len()
        || image_bytes.len() > MAX_IMAGE_BYTES
        || &image_bytes[..PNG_SIGNATURE.len()] != PNG_SIGNATURE
    {
        return Err(OcrError::InvalidInput);
    }
    Ok(())
}

fn validate_output(output: OcrEngineOutput) -> Result<OcrEngineOutput, OcrError> {
    if output.engine != OCR_ENGINE_NAME || output.lines.len() > MAX_LINES {
        return Err(OcrError::ResultInvalid);
    }
    let mut character_count = 0;
    for line in &output.lines {
        let line_characters = line.text.chars().count();
        character_count += line_characters;
        let box_is_valid = [line.x, line.y, line.width, line.height]
            .iter()
            .all(|value| value.is_finite())
            && line.x >= 0.0
            && line.y >= 0.0
            && line.width > 0.0
            && line.height > 0.0
            && line.x + line.width <= 1.000_001
            && line.y + line.height <= 1.000_001;
        if line_characters == 0
            || line_characters > MAX_LINE_CHARACTERS
            || character_count > MAX_TEXT_CHARACTERS
            || !line.confidence.is_finite()
            || !(0.0..=1.0).contains(&line.confidence)
            || !box_is_valid
        {
            return Err(OcrError::ResultInvalid);
        }
    }
    Ok(output)
}

fn required_text(value: &str, maximum: usize) -> Result<String, OcrError> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.chars().count() > maximum {
        return Err(OcrError::InvalidInput);
    }
    Ok(trimmed.to_owned())
}

fn validate_id(value: &str) -> Result<(), OcrError> {
    Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| OcrError::InvalidInput)
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex, PoisonError};

    use super::*;

    #[derive(Debug, Clone)]
    struct FakeRepository {
        saved: Arc<Mutex<Vec<OcrRecognition>>>,
    }

    impl OcrRepository for FakeRepository {
        fn find_active_region(&self, region_id: &str) -> Result<OcrRegionSource, OcrError> {
            Ok(OcrRegionSource {
                question_id: Uuid::now_v7().to_string(),
                region_id: region_id.to_owned(),
                page_number: 2,
            })
        }

        fn list_current(&self, _question_id: &str) -> Result<Vec<OcrRecognition>, OcrError> {
            Ok(self
                .saved
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .clone())
        }

        fn replace_draft(&self, recognition: OcrRecognition) -> Result<OcrRecognition, OcrError> {
            self.saved
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .push(recognition.clone());
            Ok(recognition)
        }

        fn confirm_draft(
            &self,
            _recognition_id: &str,
            _confirmed_text: &str,
            _updated_at: i64,
        ) -> Result<OcrRecognition, OcrError> {
            Err(OcrError::RecognitionNotFound)
        }

        fn discard_draft(&self, _recognition_id: &str) -> Result<(), OcrError> {
            Ok(())
        }
    }

    #[derive(Debug, Clone)]
    struct FakeEngine;

    impl OcrEngine for FakeEngine {
        fn status(&self) -> OcrComponentStatus {
            OcrComponentStatus {
                state: OcrComponentState::Available,
                engine: OCR_ENGINE_NAME,
                models_bundled: true,
                component_size_bytes: Some(1),
            }
        }

        fn recognize(
            &self,
            _image_bytes: &[u8],
            _canceled: &AtomicBool,
        ) -> Result<OcrEngineOutput, OcrError> {
            Ok(OcrEngineOutput {
                engine: OCR_ENGINE_NAME.to_owned(),
                lines: vec![OcrEngineLine {
                    text: "数据结构".to_owned(),
                    confidence: 0.98,
                    x: 0.1,
                    y: 0.2,
                    width: 0.5,
                    height: 0.1,
                }],
            })
        }
    }

    fn png_bytes() -> Vec<u8> {
        [PNG_SIGNATURE.as_slice(), b"fixture"].concat()
    }

    #[test]
    fn recognize_region_saves_a_typed_draft() {
        let repository = FakeRepository {
            saved: Arc::new(Mutex::new(Vec::new())),
        };
        let use_cases = OcrUseCases::new(repository, FakeEngine);

        let recognition = use_cases
            .recognize_region(
                &RecognizeQuestionRegionInput {
                    region_id: Uuid::now_v7().to_string(),
                    image_bytes: png_bytes(),
                },
                &AtomicBool::new(false),
            )
            .expect("valid OCR output should create a draft");

        assert_eq!(recognition.state, OcrRecognitionState::Draft);
        assert_eq!(recognition.recognized_text, "数据结构");
        assert_eq!(recognition.lines.len(), 1);
    }

    #[test]
    fn recognize_region_stops_before_the_engine_when_canceled() {
        let use_cases = OcrUseCases::new(
            FakeRepository {
                saved: Arc::new(Mutex::new(Vec::new())),
            },
            FakeEngine,
        );

        let result = use_cases.recognize_region(
            &RecognizeQuestionRegionInput {
                region_id: Uuid::now_v7().to_string(),
                image_bytes: png_bytes(),
            },
            &AtomicBool::new(true),
        );

        assert!(matches!(result, Err(OcrError::Canceled)));
    }

    #[test]
    fn recognize_region_rejects_non_png_bytes() {
        let use_cases = OcrUseCases::new(
            FakeRepository {
                saved: Arc::new(Mutex::new(Vec::new())),
            },
            FakeEngine,
        );

        let result = use_cases.recognize_region(
            &RecognizeQuestionRegionInput {
                region_id: Uuid::now_v7().to_string(),
                image_bytes: b"not-png".to_vec(),
            },
            &AtomicBool::new(false),
        );

        assert!(matches!(result, Err(OcrError::InvalidInput)));
    }

    #[test]
    fn recognize_page_rejects_zero_page_number() {
        let use_cases = OcrUseCases::new(
            FakeRepository {
                saved: Arc::new(Mutex::new(Vec::new())),
            },
            FakeEngine,
        );

        let result = use_cases.recognize_page(
            &RecognizePdfPageInput {
                page_number: 0,
                image_bytes: png_bytes(),
            },
            &AtomicBool::new(false),
        );

        assert!(matches!(result, Err(OcrError::InvalidInput)));
    }

    #[test]
    fn recognize_page_rejects_non_png_bytes() {
        let use_cases = OcrUseCases::new(
            FakeRepository {
                saved: Arc::new(Mutex::new(Vec::new())),
            },
            FakeEngine,
        );

        let result = use_cases.recognize_page(
            &RecognizePdfPageInput {
                page_number: 2,
                image_bytes: b"not-png".to_vec(),
            },
            &AtomicBool::new(false),
        );

        assert!(matches!(result, Err(OcrError::InvalidInput)));
    }

    #[test]
    fn recognize_page_stops_before_the_engine_when_canceled() {
        let use_cases = OcrUseCases::new(
            FakeRepository {
                saved: Arc::new(Mutex::new(Vec::new())),
            },
            FakeEngine,
        );

        let result = use_cases.recognize_page(
            &RecognizePdfPageInput {
                page_number: 2,
                image_bytes: png_bytes(),
            },
            &AtomicBool::new(true),
        );

        assert!(matches!(result, Err(OcrError::Canceled)));
    }

    #[test]
    fn recognize_page_returns_typed_lines_without_writing_a_repository_record() {
        let repository = FakeRepository {
            saved: Arc::new(Mutex::new(Vec::new())),
        };
        let saved = Arc::clone(&repository.saved);
        let use_cases = OcrUseCases::new(repository, FakeEngine);

        let recognition = use_cases
            .recognize_page(
                &RecognizePdfPageInput {
                    page_number: 2,
                    image_bytes: png_bytes(),
                },
                &AtomicBool::new(false),
            )
            .expect("valid OCR output should stay in memory");

        assert_eq!(recognition.page_number, 2);
        assert_eq!(recognition.engine, OCR_ENGINE_NAME);
        assert_eq!(recognition.lines.len(), 1);
        assert!(
            saved
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .is_empty()
        );
    }
}
