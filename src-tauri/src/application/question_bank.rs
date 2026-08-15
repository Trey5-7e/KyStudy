use std::collections::HashSet;

use uuid::Uuid;

use super::{PersistenceError, QuestionRegionInput, current_utc_millis};
use crate::domain::{
    AttemptResult, LocalDate, QuestionBankSnapshot, QuestionRegion, QuestionType,
    TrashedWorkbookDocumentSegment, WorkbookCategory, WorkbookDocumentSegment,
};

const MAX_INDEX_QUESTIONS: usize = 5_000;
const MAX_BULK_ATTEMPTS: usize = 1_000;
const MAX_QUESTION_GAP_ISSUE_KEY_LENGTH: usize = 500;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CreateWorkbookCategoryInput {
    pub(crate) name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WorkbookSegmentAssignmentInput {
    pub(crate) document_id: String,
    pub(crate) subject_id: String,
    pub(crate) workbook_id: String,
    pub(crate) source_heading: String,
    pub(crate) page_start: u32,
    pub(crate) page_end: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TrashWorkbookSegmentInput {
    pub(crate) segment_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RestoreWorkbookSegmentInput {
    pub(crate) segment_id: String,
    pub(crate) expected_deleted_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReassignWorkbookSegmentInput {
    pub(crate) segment_id: String,
    pub(crate) target_workbook_id: String,
    pub(crate) expected_updated_at: i64,
    pub(crate) expected_deleted_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct IndexedQuestionDraftInput {
    pub(crate) source_key: String,
    pub(crate) title: String,
    pub(crate) chapter: String,
    pub(crate) section_part: String,
    pub(crate) question_type: String,
    pub(crate) question_number: String,
    pub(crate) index_confidence: f64,
    pub(crate) regions: Vec<QuestionRegionInput>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ImportQuestionIndexInput {
    pub(crate) segment_id: String,
    pub(crate) questions: Vec<IndexedQuestionDraftInput>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BulkQuestionAttemptInput {
    pub(crate) question_id: String,
    pub(crate) result: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RecordBulkQuestionAttemptsInput {
    pub(crate) attempted_on: String,
    pub(crate) entries: Vec<BulkQuestionAttemptInput>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SetQuestionGapAcknowledgementInput {
    pub(crate) issue_key: String,
    pub(crate) acknowledged: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct UpdateIndexedQuestionInput {
    pub(crate) question_id: String,
    pub(crate) title: String,
    pub(crate) chapter: String,
    pub(crate) section_part: String,
    pub(crate) question_type: String,
    pub(crate) question_number: String,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct IndexedQuestionRegionUpdateInput {
    pub(crate) region_id: Option<String>,
    pub(crate) region: QuestionRegionInput,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ReplaceIndexedQuestionRegionsInput {
    pub(crate) question_id: String,
    pub(crate) regions: Vec<IndexedQuestionRegionUpdateInput>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct InsertIndexedQuestionInput {
    pub(crate) anchor_question_id: String,
    pub(crate) placement: String,
    pub(crate) title: String,
    pub(crate) chapter: String,
    pub(crate) section_part: String,
    pub(crate) question_type: String,
    pub(crate) question_number: String,
    pub(crate) regions: Vec<QuestionRegionInput>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ValidatedIndexedQuestionUpdate {
    pub(crate) question_id: String,
    pub(crate) title: String,
    pub(crate) chapter: String,
    pub(crate) section_part: String,
    pub(crate) question_type: QuestionType,
    pub(crate) question_number: String,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ValidatedIndexedQuestion {
    pub(crate) id: String,
    pub(crate) source_key: String,
    pub(crate) title: String,
    pub(crate) chapter: String,
    pub(crate) section_part: String,
    pub(crate) question_type: QuestionType,
    pub(crate) question_number: String,
    pub(crate) index_confidence: f64,
    pub(crate) sort_order: u32,
    pub(crate) regions: Vec<QuestionRegion>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ValidatedBulkAttempt {
    pub(crate) id: String,
    pub(crate) question_id: String,
    pub(crate) result: AttemptResult,
    pub(crate) attempted_at: i64,
}

/// Describes an active segment that already owns an exact document/subject range.
///
/// The workbook is intentionally part of the conflict payload rather than the
/// identity key: an exact range can be reused by another subject in a mixed PDF,
/// but it must not silently move between workbooks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SegmentAssignmentConflict {
    pub(crate) document_id: String,
    pub(crate) subject_id: String,
    pub(crate) page_start: u32,
    pub(crate) page_end: u32,
    pub(crate) requested_workbook_id: String,
    pub(crate) existing_segment_id: String,
    pub(crate) existing_workbook_id: String,
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum QuestionBankError {
    #[error("workspace is not initialized")]
    WorkspaceNotInitialized,
    #[error("question-bank input is invalid")]
    InvalidInput,
    #[error("workbook category already exists")]
    WorkbookAlreadyExists,
    #[error("workbook category was not found")]
    WorkbookNotFound,
    #[error("PDF document was not found")]
    DocumentNotFound,
    #[error("subject was not found")]
    SubjectNotFound,
    #[error("PDF subject segment was not found")]
    SegmentNotFound,
    #[error("PDF subject segment is not active")]
    SegmentNotActive,
    #[error("PDF subject segment is not in the trash")]
    SegmentNotTrashed,
    #[error("PDF subject segment restore precondition is stale")]
    SegmentRestoreStale,
    #[error("PDF subject segment reassignment precondition is stale")]
    SegmentReassignStale,
    #[error("PDF subject segment is already assigned to another workbook")]
    SegmentAssignmentConflict {
        conflicts: Vec<SegmentAssignmentConflict>,
    },
    #[error("indexed question was not found")]
    QuestionNotFound,
    #[error(transparent)]
    Persistence(#[from] PersistenceError),
}

impl QuestionBankError {
    pub(crate) fn segment_assignment_conflicts(
        conflicts: Vec<(String, String, u32, u32, String, String, String)>,
    ) -> Self {
        Self::SegmentAssignmentConflict {
            conflicts: conflicts
                .into_iter()
                .map(
                    |(
                        document_id,
                        subject_id,
                        page_start,
                        page_end,
                        requested_workbook_id,
                        existing_segment_id,
                        existing_workbook_id,
                    )| SegmentAssignmentConflict {
                        document_id,
                        subject_id,
                        page_start,
                        page_end,
                        requested_workbook_id,
                        existing_segment_id,
                        existing_workbook_id,
                    },
                )
                .collect(),
        }
    }

    pub(crate) const fn code(&self) -> &'static str {
        match self {
            Self::WorkspaceNotInitialized => "WORKSPACE_NOT_INITIALIZED",
            Self::InvalidInput => "QUESTION_BANK_INPUT_INVALID",
            Self::WorkbookAlreadyExists => "WORKBOOK_CATEGORY_EXISTS",
            Self::WorkbookNotFound => "WORKBOOK_CATEGORY_NOT_FOUND",
            Self::DocumentNotFound => "QUESTION_BANK_DOCUMENT_NOT_FOUND",
            Self::SubjectNotFound => "QUESTION_BANK_SUBJECT_NOT_FOUND",
            Self::SegmentNotFound => "QUESTION_BANK_SEGMENT_NOT_FOUND",
            Self::SegmentNotActive => "QUESTION_BANK_SEGMENT_NOT_ACTIVE",
            Self::SegmentNotTrashed => "QUESTION_BANK_SEGMENT_NOT_TRASHED",
            Self::SegmentRestoreStale => "QUESTION_BANK_SEGMENT_RESTORE_STALE",
            Self::SegmentReassignStale => "QUESTION_BANK_SEGMENT_REASSIGN_STALE",
            Self::SegmentAssignmentConflict { .. } => "QUESTION_BANK_SEGMENT_ASSIGNMENT_CONFLICT",
            Self::QuestionNotFound => "QUESTION_BANK_QUESTION_NOT_FOUND",
            Self::Persistence(error) => error.code(),
        }
    }
}

pub(crate) trait QuestionBankRepository: Clone + Send + Sync + 'static {
    fn snapshot(&self) -> Result<QuestionBankSnapshot, QuestionBankError>;
    fn list_trashed_segments(
        &self,
    ) -> Result<Vec<TrashedWorkbookDocumentSegment>, QuestionBankError>;
    fn question_gap_acknowledgements(&self) -> Result<Vec<String>, QuestionBankError>;
    fn set_question_gap_acknowledgement(
        &self,
        issue_key: &str,
        acknowledged: bool,
        acknowledged_at: i64,
    ) -> Result<Vec<String>, QuestionBankError>;
    fn create_workbook(
        &self,
        workbook: WorkbookCategory,
    ) -> Result<WorkbookCategory, QuestionBankError>;
    fn save_segments(
        &self,
        segments: &[WorkbookDocumentSegment],
    ) -> Result<Vec<WorkbookDocumentSegment>, QuestionBankError>;
    fn trash_segment(
        &self,
        segment_id: &str,
        deleted_at: i64,
    ) -> Result<QuestionBankSnapshot, QuestionBankError>;
    fn restore_segment(
        &self,
        segment_id: &str,
        expected_deleted_at: i64,
        restored_at: i64,
    ) -> Result<QuestionBankSnapshot, QuestionBankError>;
    fn reassign_segment(
        &self,
        segment_id: &str,
        target_workbook_id: &str,
        expected_updated_at: i64,
        expected_deleted_at: Option<i64>,
        reassigned_at: i64,
    ) -> Result<QuestionBankSnapshot, QuestionBankError>;
    fn import_index(
        &self,
        segment_id: &str,
        questions: &[ValidatedIndexedQuestion],
        updated_at: i64,
    ) -> Result<QuestionBankSnapshot, QuestionBankError>;
    fn record_attempts(
        &self,
        attempts: &[ValidatedBulkAttempt],
        attempted_on: &LocalDate,
    ) -> Result<QuestionBankSnapshot, QuestionBankError>;
    fn update_question(
        &self,
        update: &ValidatedIndexedQuestionUpdate,
        updated_at: i64,
    ) -> Result<QuestionBankSnapshot, QuestionBankError>;
    fn replace_question_regions(
        &self,
        question_id: &str,
        regions: &[QuestionRegion],
        updated_at: i64,
    ) -> Result<QuestionBankSnapshot, QuestionBankError>;
    fn insert_question_relative(
        &self,
        anchor_question_id: &str,
        question: &ValidatedIndexedQuestion,
        insert_before: bool,
        updated_at: i64,
    ) -> Result<QuestionBankSnapshot, QuestionBankError>;
    fn trash_question(
        &self,
        question_id: &str,
        deleted_at: i64,
    ) -> Result<QuestionBankSnapshot, QuestionBankError>;
}

#[derive(Debug, Clone)]
pub(crate) struct QuestionBankUseCases<R> {
    repository: R,
}

impl<R: QuestionBankRepository> QuestionBankUseCases<R> {
    pub(crate) const fn new(repository: R) -> Self {
        Self { repository }
    }

    pub(crate) fn snapshot(&self) -> Result<QuestionBankSnapshot, QuestionBankError> {
        self.repository.snapshot()
    }

    pub(crate) fn list_trashed_workbook_segments(
        &self,
    ) -> Result<Vec<TrashedWorkbookDocumentSegment>, QuestionBankError> {
        self.repository.list_trashed_segments()
    }

    pub(crate) fn question_gap_acknowledgements(&self) -> Result<Vec<String>, QuestionBankError> {
        let mut issue_keys = self.repository.question_gap_acknowledgements()?;
        issue_keys.sort_unstable();
        Ok(issue_keys)
    }

    pub(crate) fn set_question_gap_acknowledgement(
        &self,
        input: &SetQuestionGapAcknowledgementInput,
    ) -> Result<Vec<String>, QuestionBankError> {
        let issue_key = validate_question_gap_issue_key(&input.issue_key)?;
        let mut issue_keys = self.repository.set_question_gap_acknowledgement(
            &issue_key,
            input.acknowledged,
            current_utc_millis()?,
        )?;
        issue_keys.sort_unstable();
        Ok(issue_keys)
    }

    pub(crate) fn create_workbook(
        &self,
        input: &CreateWorkbookCategoryInput,
    ) -> Result<WorkbookCategory, QuestionBankError> {
        let name = required_text(&input.name, 120)?;
        let now = current_utc_millis()?;
        self.repository.create_workbook(WorkbookCategory {
            id: Uuid::now_v7().to_string(),
            name,
            created_at: now,
            updated_at: now,
        })
    }

    pub(crate) fn save_segments(
        &self,
        assignments: Vec<WorkbookSegmentAssignmentInput>,
    ) -> Result<Vec<WorkbookDocumentSegment>, QuestionBankError> {
        if assignments.is_empty() || assignments.len() > 20 {
            return Err(QuestionBankError::InvalidInput);
        }
        let now = current_utc_millis()?;
        let mut unique_ranges = HashSet::new();
        let segments = assignments
            .into_iter()
            .map(|assignment| {
                validate_id(&assignment.document_id)?;
                validate_id(&assignment.subject_id)?;
                validate_id(&assignment.workbook_id)?;
                if assignment.page_start == 0 || assignment.page_end < assignment.page_start {
                    return Err(QuestionBankError::InvalidInput);
                }
                let source_heading = required_text(&assignment.source_heading, 200)?;
                let range_key = (
                    assignment.document_id.clone(),
                    assignment.subject_id.clone(),
                    assignment.page_start,
                    assignment.page_end,
                );
                if !unique_ranges.insert(range_key) {
                    return Err(QuestionBankError::InvalidInput);
                }
                Ok(WorkbookDocumentSegment {
                    id: Uuid::now_v7().to_string(),
                    document_id: assignment.document_id,
                    document_title: String::new(),
                    subject_id: assignment.subject_id,
                    subject_name: String::new(),
                    workbook_id: assignment.workbook_id,
                    workbook_name: String::new(),
                    source_heading,
                    page_start: assignment.page_start,
                    page_end: assignment.page_end,
                    index_state: "pending".to_owned(),
                    question_count: 0,
                    created_at: now,
                    updated_at: now,
                })
            })
            .collect::<Result<Vec<_>, QuestionBankError>>()?;
        self.repository.save_segments(&segments)
    }

    pub(crate) fn trash_segment(
        &self,
        input: &TrashWorkbookSegmentInput,
    ) -> Result<QuestionBankSnapshot, QuestionBankError> {
        validate_id(&input.segment_id)?;
        self.repository
            .trash_segment(&input.segment_id, current_utc_millis()?)
    }

    pub(crate) fn restore_workbook_segment(
        &self,
        input: &RestoreWorkbookSegmentInput,
    ) -> Result<QuestionBankSnapshot, QuestionBankError> {
        validate_id(&input.segment_id)?;
        if input.expected_deleted_at <= 0 {
            return Err(QuestionBankError::InvalidInput);
        }
        self.repository.restore_segment(
            &input.segment_id,
            input.expected_deleted_at,
            current_utc_millis()?,
        )
    }

    pub(crate) fn reassign_workbook_segment(
        &self,
        input: &ReassignWorkbookSegmentInput,
    ) -> Result<QuestionBankSnapshot, QuestionBankError> {
        validate_id(&input.segment_id)?;
        validate_id(&input.target_workbook_id)?;
        if input.expected_updated_at <= 0
            || input
                .expected_deleted_at
                .is_some_and(|deleted_at| deleted_at <= 0)
        {
            return Err(QuestionBankError::InvalidInput);
        }
        self.repository.reassign_segment(
            &input.segment_id,
            &input.target_workbook_id,
            input.expected_updated_at,
            input.expected_deleted_at,
            current_utc_millis()?,
        )
    }

    pub(crate) fn import_index(
        &self,
        input: ImportQuestionIndexInput,
    ) -> Result<QuestionBankSnapshot, QuestionBankError> {
        validate_id(&input.segment_id)?;
        if input.questions.is_empty() || input.questions.len() > MAX_INDEX_QUESTIONS {
            return Err(QuestionBankError::InvalidInput);
        }
        let mut source_keys = HashSet::new();
        let questions = input
            .questions
            .into_iter()
            .enumerate()
            .map(|(index, question)| {
                let source_key = required_text(&question.source_key, 500)?;
                if !source_keys.insert(source_key.clone()) {
                    return Err(QuestionBankError::InvalidInput);
                }
                let title = required_text(&question.title, 200)?;
                let chapter = required_text(&question.chapter, 120)?;
                let question_number = required_text(&question.question_number, 60)?;
                let question_type = QuestionType::parse(&question.question_type)
                    .ok_or(QuestionBankError::InvalidInput)?;
                if !matches!(
                    question.section_part.as_str(),
                    "basic" | "comprehensive" | "extended" | "other"
                ) || !question.index_confidence.is_finite()
                    || !(0.0..=1.0).contains(&question.index_confidence)
                    || question.regions.is_empty()
                    || question.regions.len() > 12
                {
                    return Err(QuestionBankError::InvalidInput);
                }
                let question_id = Uuid::now_v7().to_string();
                let regions = question
                    .regions
                    .into_iter()
                    .enumerate()
                    .map(|(region_index, region)| {
                        validate_region(&region)?;
                        Ok(QuestionRegion {
                            id: Uuid::now_v7().to_string(),
                            question_id: question_id.clone(),
                            document_id: String::new(),
                            page_number: region.page_number,
                            x: region.x,
                            y: region.y,
                            width: region.width,
                            height: region.height,
                            coordinate_version: 1,
                            sort_order: u32::try_from(region_index)
                                .map_err(|_| QuestionBankError::InvalidInput)?,
                            created_at: 0,
                        })
                    })
                    .collect::<Result<Vec<_>, QuestionBankError>>()?;
                Ok(ValidatedIndexedQuestion {
                    id: question_id,
                    source_key,
                    title,
                    chapter,
                    section_part: question.section_part,
                    question_type,
                    question_number,
                    index_confidence: question.index_confidence,
                    sort_order: u32::try_from(index)
                        .map_err(|_| QuestionBankError::InvalidInput)?,
                    regions,
                })
            })
            .collect::<Result<Vec<_>, QuestionBankError>>()?;
        self.repository
            .import_index(&input.segment_id, &questions, current_utc_millis()?)
    }

    pub(crate) fn record_attempts(
        &self,
        input: RecordBulkQuestionAttemptsInput,
    ) -> Result<QuestionBankSnapshot, QuestionBankError> {
        let attempted_on =
            LocalDate::parse(&input.attempted_on).map_err(|_| QuestionBankError::InvalidInput)?;
        if input.entries.is_empty() || input.entries.len() > MAX_BULK_ATTEMPTS {
            return Err(QuestionBankError::InvalidInput);
        }
        let attempted_at = current_utc_millis()?;
        let mut question_ids = HashSet::new();
        let attempts = input
            .entries
            .into_iter()
            .map(|entry| {
                validate_id(&entry.question_id)?;
                if !question_ids.insert(entry.question_id.clone()) {
                    return Err(QuestionBankError::InvalidInput);
                }
                let result =
                    AttemptResult::parse(&entry.result).ok_or(QuestionBankError::InvalidInput)?;
                Ok(ValidatedBulkAttempt {
                    id: Uuid::now_v7().to_string(),
                    question_id: entry.question_id,
                    result,
                    attempted_at,
                })
            })
            .collect::<Result<Vec<_>, QuestionBankError>>()?;
        self.repository.record_attempts(&attempts, &attempted_on)
    }

    pub(crate) fn update_question(
        &self,
        input: UpdateIndexedQuestionInput,
    ) -> Result<QuestionBankSnapshot, QuestionBankError> {
        validate_id(&input.question_id)?;
        let question_type =
            QuestionType::parse(&input.question_type).ok_or(QuestionBankError::InvalidInput)?;
        if !matches!(
            input.section_part.as_str(),
            "basic" | "comprehensive" | "extended" | "other"
        ) {
            return Err(QuestionBankError::InvalidInput);
        }
        let update = ValidatedIndexedQuestionUpdate {
            question_id: input.question_id,
            title: required_text(&input.title, 200)?,
            chapter: required_text(&input.chapter, 120)?,
            section_part: input.section_part,
            question_type,
            question_number: required_text(&input.question_number, 60)?,
        };
        self.repository
            .update_question(&update, current_utc_millis()?)
    }

    pub(crate) fn trash_question(
        &self,
        question_id: &str,
    ) -> Result<QuestionBankSnapshot, QuestionBankError> {
        validate_id(question_id)?;
        self.repository
            .trash_question(question_id, current_utc_millis()?)
    }

    pub(crate) fn replace_question_regions(
        &self,
        input: ReplaceIndexedQuestionRegionsInput,
    ) -> Result<QuestionBankSnapshot, QuestionBankError> {
        validate_id(&input.question_id)?;
        if input.regions.is_empty() || input.regions.len() > 12 {
            return Err(QuestionBankError::InvalidInput);
        }
        let now = current_utc_millis()?;
        let mut region_ids = HashSet::new();
        let regions = input
            .regions
            .into_iter()
            .enumerate()
            .map(|(index, input_region)| {
                validate_region(&input_region.region)?;
                let region_id = match input_region.region_id {
                    Some(id) => {
                        validate_id(&id)?;
                        id
                    }
                    None => Uuid::now_v7().to_string(),
                };
                if !region_ids.insert(region_id.clone()) {
                    return Err(QuestionBankError::InvalidInput);
                }
                Ok(QuestionRegion {
                    id: region_id,
                    question_id: input.question_id.clone(),
                    document_id: String::new(),
                    page_number: input_region.region.page_number,
                    x: input_region.region.x,
                    y: input_region.region.y,
                    width: input_region.region.width,
                    height: input_region.region.height,
                    coordinate_version: 1,
                    sort_order: u32::try_from(index)
                        .map_err(|_| QuestionBankError::InvalidInput)?,
                    created_at: now,
                })
            })
            .collect::<Result<Vec<_>, QuestionBankError>>()?;
        self.repository
            .replace_question_regions(&input.question_id, &regions, now)
    }

    pub(crate) fn insert_question_relative(
        &self,
        input: InsertIndexedQuestionInput,
    ) -> Result<QuestionBankSnapshot, QuestionBankError> {
        validate_id(&input.anchor_question_id)?;
        let insert_before = match input.placement.as_str() {
            "before" => true,
            "after" => false,
            _ => return Err(QuestionBankError::InvalidInput),
        };
        if input.regions.is_empty() || input.regions.len() > 12 {
            return Err(QuestionBankError::InvalidInput);
        }
        let question_type =
            QuestionType::parse(&input.question_type).ok_or(QuestionBankError::InvalidInput)?;
        if !matches!(
            input.section_part.as_str(),
            "basic" | "comprehensive" | "extended" | "other"
        ) {
            return Err(QuestionBankError::InvalidInput);
        }
        let now = current_utc_millis()?;
        let question_id = Uuid::now_v7().to_string();
        let regions = input
            .regions
            .into_iter()
            .enumerate()
            .map(|(index, region)| {
                validate_region(&region)?;
                Ok(QuestionRegion {
                    id: Uuid::now_v7().to_string(),
                    question_id: question_id.clone(),
                    document_id: String::new(),
                    page_number: region.page_number,
                    x: region.x,
                    y: region.y,
                    width: region.width,
                    height: region.height,
                    coordinate_version: 1,
                    sort_order: u32::try_from(index)
                        .map_err(|_| QuestionBankError::InvalidInput)?,
                    created_at: now,
                })
            })
            .collect::<Result<Vec<_>, QuestionBankError>>()?;
        let question = ValidatedIndexedQuestion {
            id: question_id.clone(),
            source_key: format!("manual|{question_id}"),
            title: required_text(&input.title, 200)?,
            chapter: required_text(&input.chapter, 120)?,
            section_part: input.section_part,
            question_type,
            question_number: required_text(&input.question_number, 60)?,
            index_confidence: 1.0,
            sort_order: 0,
            regions,
        };
        self.repository.insert_question_relative(
            &input.anchor_question_id,
            &question,
            insert_before,
            now,
        )
    }
}

fn validate_id(value: &str) -> Result<(), QuestionBankError> {
    Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| QuestionBankError::InvalidInput)
}

fn required_text(value: &str, maximum: usize) -> Result<String, QuestionBankError> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > maximum {
        return Err(QuestionBankError::InvalidInput);
    }
    Ok(trimmed.to_owned())
}

fn validate_question_gap_issue_key(value: &str) -> Result<String, QuestionBankError> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.len() > MAX_QUESTION_GAP_ISSUE_KEY_LENGTH
        || !(trimmed.starts_with("duplicate|")
            || trimmed.starts_with("jump|")
            || trimmed.starts_with("non_numeric|"))
    {
        return Err(QuestionBankError::InvalidInput);
    }
    Ok(trimmed.to_owned())
}

fn validate_region(region: &QuestionRegionInput) -> Result<(), QuestionBankError> {
    let values = [region.x, region.y, region.width, region.height];
    if region.page_number == 0
        || values.iter().any(|value| !value.is_finite())
        || region.x < 0.0
        || region.y < 0.0
        || region.width <= 0.002
        || region.height <= 0.002
        || region.x + region.width > 1.000_001
        || region.y + region.height > 1.000_001
    {
        return Err(QuestionBankError::InvalidInput);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        SetQuestionGapAcknowledgementInput, required_text, validate_question_gap_issue_key,
    };

    #[test]
    fn required_text_trims_valid_category_name() {
        let value = required_text(" 880 ", 120).expect("name should be valid");

        assert_eq!(value, "880");
    }

    #[test]
    fn required_text_rejects_blank_category_name() {
        let error = super::required_text("   ", 120).expect_err("blank should fail");

        assert_eq!(error.code(), "QUESTION_BANK_INPUT_INVALID");
    }

    #[test]
    fn question_gap_issue_key_trims_supported_prefixes() {
        let key = validate_question_gap_issue_key("  jump|question-a  ")
            .expect("supported issue key should validate");

        assert_eq!(key, "jump|question-a");
    }

    #[test]
    fn question_gap_issue_key_rejects_unsupported_prefix() {
        let error = validate_question_gap_issue_key("missing|question-a")
            .expect_err("unsupported issue key should fail");

        assert_eq!(error.code(), "QUESTION_BANK_INPUT_INVALID");
    }

    #[test]
    fn question_gap_issue_key_rejects_values_longer_than_limit() {
        let value = format!("duplicate|{}", "x".repeat(500));

        let error =
            validate_question_gap_issue_key(&value).expect_err("oversized issue key should fail");

        assert_eq!(error.code(), "QUESTION_BANK_INPUT_INVALID");
    }

    #[test]
    fn set_question_gap_acknowledgement_input_keeps_explicit_state() {
        let input = SetQuestionGapAcknowledgementInput {
            issue_key: "duplicate|question-a".to_owned(),
            acknowledged: false,
        };

        assert!(!input.acknowledged);
    }
}
