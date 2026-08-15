use super::{AttemptResult, QuestionRegion, QuestionType};

/// User-created exercise-book category shown below each subject root.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WorkbookCategory {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
}

/// One subject-specific page range extracted from a physical PDF document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WorkbookDocumentSegment {
    pub(crate) id: String,
    pub(crate) document_id: String,
    pub(crate) document_title: String,
    pub(crate) subject_id: String,
    pub(crate) subject_name: String,
    pub(crate) workbook_id: String,
    pub(crate) workbook_name: String,
    pub(crate) source_heading: String,
    pub(crate) page_start: u32,
    pub(crate) page_end: u32,
    pub(crate) index_state: String,
    pub(crate) question_count: u32,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
}

/// A segment currently in the workbook trash, retaining the metadata needed
/// to show a safe, deterministic restore affordance.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TrashedWorkbookDocumentSegment {
    pub(crate) id: String,
    pub(crate) document_id: String,
    pub(crate) document_title: String,
    pub(crate) subject_id: String,
    pub(crate) subject_name: String,
    pub(crate) workbook_id: String,
    pub(crate) workbook_name: String,
    pub(crate) source_heading: String,
    pub(crate) page_start: u32,
    pub(crate) page_end: u32,
    pub(crate) index_state: String,
    pub(crate) question_count: u32,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
    pub(crate) deleted_at: i64,
    pub(crate) restorable_question_count: u32,
}

/// Lightweight indexed question used by browsing, bulk logging, and paper generation.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct IndexedQuestion {
    pub(crate) id: String,
    pub(crate) document_id: String,
    pub(crate) document_title: String,
    pub(crate) subject_id: String,
    pub(crate) subject_name: String,
    pub(crate) workbook_id: String,
    pub(crate) workbook_name: String,
    pub(crate) segment_id: String,
    pub(crate) chapter: String,
    pub(crate) section_part: String,
    pub(crate) question_type: QuestionType,
    pub(crate) question_number: String,
    pub(crate) title: String,
    pub(crate) index_confidence: f64,
    pub(crate) sort_order: u32,
    pub(crate) current_result: Option<AttemptResult>,
    pub(crate) attempt_count: u32,
    pub(crate) incorrect_count: u32,
    pub(crate) partial_count: u32,
    pub(crate) regions: Vec<QuestionRegion>,
}

/// Complete local question-bank snapshot.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct QuestionBankSnapshot {
    pub(crate) workbooks: Vec<WorkbookCategory>,
    pub(crate) segments: Vec<WorkbookDocumentSegment>,
    pub(crate) questions: Vec<IndexedQuestion>,
}
