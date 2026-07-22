/// Lifecycle state for one OCR result attached to a question region.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum OcrRecognitionState {
    Draft,
    Confirmed,
    Superseded,
}

impl OcrRecognitionState {
    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "draft" => Some(Self::Draft),
            "confirmed" => Some(Self::Confirmed),
            "superseded" => Some(Self::Superseded),
            _ => None,
        }
    }

    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Confirmed => "confirmed",
            Self::Superseded => "superseded",
        }
    }
}

/// One OCR text line with a box normalized to the submitted region image.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct OcrTextLine {
    pub(crate) id: String,
    pub(crate) recognition_id: String,
    pub(crate) text: String,
    pub(crate) confidence: f64,
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
    pub(crate) sort_order: u32,
}

/// OCR draft or user-confirmed text for one saved question region.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct OcrRecognition {
    pub(crate) id: String,
    pub(crate) question_id: String,
    pub(crate) region_id: String,
    pub(crate) page_number: u32,
    pub(crate) engine: String,
    pub(crate) recognized_text: String,
    pub(crate) confirmed_text: Option<String>,
    pub(crate) mean_confidence: f64,
    pub(crate) state: OcrRecognitionState,
    pub(crate) lines: Vec<OcrTextLine>,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
}
