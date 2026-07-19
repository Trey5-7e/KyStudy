use std::collections::HashSet;

use uuid::Uuid;

use super::{PersistenceError, current_utc_millis};
use crate::domain::{AttemptResult, Question, QuestionAttempt, QuestionBundle, QuestionRegion};

const MIN_REGION_SPAN: f64 = 0.002;
const MAX_KNOWLEDGE_LINKS: usize = 20;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct QuestionRegionInput {
    pub(crate) page_number: u32,
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct CreateQuestionInput {
    pub(crate) document_id: String,
    pub(crate) title: String,
    pub(crate) chapter: Option<String>,
    pub(crate) question_number: Option<String>,
    pub(crate) difficulty: u8,
    pub(crate) analysis_markdown: Option<String>,
    pub(crate) region: QuestionRegionInput,
    pub(crate) knowledge_node_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct UpdateQuestionInput {
    pub(crate) question_id: String,
    pub(crate) title: String,
    pub(crate) chapter: Option<String>,
    pub(crate) question_number: Option<String>,
    pub(crate) difficulty: u8,
    pub(crate) analysis_markdown: Option<String>,
    pub(crate) knowledge_node_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct AddQuestionRegionInput {
    pub(crate) question_id: String,
    pub(crate) region: QuestionRegionInput,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AddQuestionAttemptInput {
    pub(crate) question_id: String,
    pub(crate) result: String,
    pub(crate) duration_seconds: Option<u32>,
    pub(crate) answer_note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ValidatedQuestionUpdate {
    pub(crate) question_id: String,
    pub(crate) title: String,
    pub(crate) chapter: Option<String>,
    pub(crate) question_number: Option<String>,
    pub(crate) difficulty: u8,
    pub(crate) analysis_markdown: Option<String>,
    pub(crate) knowledge_node_ids: Vec<String>,
    pub(crate) updated_at: i64,
}

/// Stable failures from manual workbook question management.
#[derive(Debug, thiserror::Error)]
pub(crate) enum QuestionError {
    #[error("workspace is not initialized")]
    WorkspaceNotInitialized,
    #[error("workbook was not found")]
    WorkbookNotFound,
    #[error("question was not found")]
    QuestionNotFound,
    #[error("question region was not found")]
    RegionNotFound,
    #[error("question input is invalid")]
    InvalidInput,
    #[error("question region is invalid")]
    InvalidRegion,
    #[error("a question must keep at least one region")]
    LastRegionProtected,
    #[error("knowledge-node association is invalid")]
    InvalidKnowledgeLink,
    #[error(transparent)]
    Persistence(#[from] PersistenceError),
}

impl QuestionError {
    pub(crate) const fn code(&self) -> &'static str {
        match self {
            Self::WorkspaceNotInitialized => "WORKSPACE_NOT_INITIALIZED",
            Self::WorkbookNotFound => "WORKBOOK_NOT_FOUND",
            Self::QuestionNotFound => "QUESTION_NOT_FOUND",
            Self::RegionNotFound => "QUESTION_REGION_NOT_FOUND",
            Self::InvalidInput => "QUESTION_INPUT_INVALID",
            Self::InvalidRegion => "QUESTION_REGION_INVALID",
            Self::LastRegionProtected => "QUESTION_LAST_REGION_PROTECTED",
            Self::InvalidKnowledgeLink => "QUESTION_KNOWLEDGE_LINK_INVALID",
            Self::Persistence(error) => error.code(),
        }
    }
}

/// Persistence boundary for formal questions, regions, and attempts.
pub(crate) trait QuestionRepository: Clone + Send + Sync + 'static {
    fn list_for_document(&self, document_id: &str) -> Result<Vec<QuestionBundle>, QuestionError>;
    fn list_trashed(&self) -> Result<Vec<QuestionBundle>, QuestionError>;
    fn create_question(
        &self,
        question: Question,
        region: QuestionRegion,
        knowledge_node_ids: &[String],
    ) -> Result<QuestionBundle, QuestionError>;
    fn update_question(
        &self,
        update: &ValidatedQuestionUpdate,
    ) -> Result<QuestionBundle, QuestionError>;
    fn add_region(&self, region: QuestionRegion) -> Result<QuestionBundle, QuestionError>;
    fn delete_region(
        &self,
        region_id: &str,
        updated_at: i64,
    ) -> Result<QuestionBundle, QuestionError>;
    fn add_attempt(&self, attempt: QuestionAttempt) -> Result<QuestionBundle, QuestionError>;
    fn trash_question(&self, question_id: &str, deleted_at: i64) -> Result<(), QuestionError>;
    fn restore_question(
        &self,
        question_id: &str,
        updated_at: i64,
    ) -> Result<QuestionBundle, QuestionError>;
}

/// Manual, offline workbook question use cases.
#[derive(Debug, Clone)]
pub(crate) struct QuestionUseCases<R> {
    repository: R,
}

impl<R: QuestionRepository> QuestionUseCases<R> {
    pub(crate) const fn new(repository: R) -> Self {
        Self { repository }
    }

    pub(crate) fn list_for_document(
        &self,
        document_id: &str,
    ) -> Result<Vec<QuestionBundle>, QuestionError> {
        validate_id(document_id)?;
        self.repository.list_for_document(document_id)
    }

    pub(crate) fn list_trashed(&self) -> Result<Vec<QuestionBundle>, QuestionError> {
        self.repository.list_trashed()
    }

    pub(crate) fn create_question(
        &self,
        input: CreateQuestionInput,
    ) -> Result<QuestionBundle, QuestionError> {
        validate_id(&input.document_id)?;
        validate_difficulty(input.difficulty)?;
        let knowledge_node_ids = validate_knowledge_ids(input.knowledge_node_ids)?;
        let now = current_utc_millis()?;
        let question_id = Uuid::now_v7().to_string();
        self.repository.create_question(
            Question {
                id: question_id.clone(),
                document_id: input.document_id.clone(),
                document_title: String::new(),
                title: required_text(&input.title, 200)?,
                chapter: optional_text(input.chapter, 120)?,
                number_label: optional_text(input.question_number, 60)?,
                difficulty: input.difficulty,
                analysis_markdown: optional_text(input.analysis_markdown, 20_000)?,
                deleted_at: None,
                created_at: now,
                updated_at: now,
            },
            build_region(
                Uuid::now_v7().to_string(),
                question_id,
                input.document_id,
                &input.region,
                0,
                now,
            )?,
            &knowledge_node_ids,
        )
    }

    pub(crate) fn update_question(
        &self,
        input: UpdateQuestionInput,
    ) -> Result<QuestionBundle, QuestionError> {
        validate_id(&input.question_id)?;
        validate_difficulty(input.difficulty)?;
        self.repository.update_question(&ValidatedQuestionUpdate {
            question_id: input.question_id,
            title: required_text(&input.title, 200)?,
            chapter: optional_text(input.chapter, 120)?,
            question_number: optional_text(input.question_number, 60)?,
            difficulty: input.difficulty,
            analysis_markdown: optional_text(input.analysis_markdown, 20_000)?,
            knowledge_node_ids: validate_knowledge_ids(input.knowledge_node_ids)?,
            updated_at: current_utc_millis()?,
        })
    }

    pub(crate) fn add_region(
        &self,
        input: AddQuestionRegionInput,
    ) -> Result<QuestionBundle, QuestionError> {
        validate_id(&input.question_id)?;
        let now = current_utc_millis()?;
        self.repository.add_region(build_region(
            Uuid::now_v7().to_string(),
            input.question_id,
            String::new(),
            &input.region,
            u32::MAX,
            now,
        )?)
    }

    pub(crate) fn delete_region(&self, region_id: &str) -> Result<QuestionBundle, QuestionError> {
        validate_id(region_id)?;
        self.repository
            .delete_region(region_id, current_utc_millis()?)
    }

    pub(crate) fn add_attempt(
        &self,
        input: AddQuestionAttemptInput,
    ) -> Result<QuestionBundle, QuestionError> {
        validate_id(&input.question_id)?;
        let result = AttemptResult::parse(&input.result).ok_or(QuestionError::InvalidInput)?;
        if input
            .duration_seconds
            .is_some_and(|seconds| !(1..=86_400).contains(&seconds))
        {
            return Err(QuestionError::InvalidInput);
        }
        let now = current_utc_millis()?;
        self.repository.add_attempt(QuestionAttempt {
            id: Uuid::now_v7().to_string(),
            question_id: input.question_id,
            result,
            attempted_at: now,
            duration_seconds: input.duration_seconds,
            answer_note: optional_text(input.answer_note, 10_000)?,
            created_at: now,
        })
    }

    pub(crate) fn trash_question(&self, question_id: &str) -> Result<(), QuestionError> {
        validate_id(question_id)?;
        self.repository
            .trash_question(question_id, current_utc_millis()?)
    }

    pub(crate) fn restore_question(
        &self,
        question_id: &str,
    ) -> Result<QuestionBundle, QuestionError> {
        validate_id(question_id)?;
        self.repository
            .restore_question(question_id, current_utc_millis()?)
    }
}

fn build_region(
    id: String,
    question_id: String,
    document_id: String,
    input: &QuestionRegionInput,
    sort_order: u32,
    created_at: i64,
) -> Result<QuestionRegion, QuestionError> {
    let values = [input.x, input.y, input.width, input.height];
    if input.page_number == 0
        || values.iter().any(|value| !value.is_finite())
        || input.x < 0.0
        || input.y < 0.0
        || input.width < MIN_REGION_SPAN
        || input.height < MIN_REGION_SPAN
        || input.x + input.width > 1.000_001
        || input.y + input.height > 1.000_001
    {
        return Err(QuestionError::InvalidRegion);
    }
    Ok(QuestionRegion {
        id,
        question_id,
        document_id,
        page_number: input.page_number,
        x: input.x,
        y: input.y,
        width: input.width,
        height: input.height,
        coordinate_version: 1,
        sort_order,
        created_at,
    })
}

fn validate_knowledge_ids(values: Vec<String>) -> Result<Vec<String>, QuestionError> {
    if values.len() > MAX_KNOWLEDGE_LINKS {
        return Err(QuestionError::InvalidKnowledgeLink);
    }
    let mut unique = HashSet::with_capacity(values.len());
    for value in &values {
        validate_id(value).map_err(|_| QuestionError::InvalidKnowledgeLink)?;
        if !unique.insert(value.as_str()) {
            return Err(QuestionError::InvalidKnowledgeLink);
        }
    }
    Ok(values)
}

fn validate_difficulty(value: u8) -> Result<(), QuestionError> {
    if (1..=5).contains(&value) {
        Ok(())
    } else {
        Err(QuestionError::InvalidInput)
    }
}

fn required_text(value: &str, maximum: usize) -> Result<String, QuestionError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > maximum {
        return Err(QuestionError::InvalidInput);
    }
    Ok(value.to_owned())
}

fn optional_text(value: Option<String>, maximum: usize) -> Result<Option<String>, QuestionError> {
    match value {
        Some(value) if !value.trim().is_empty() => {
            let value = value.trim();
            if value.chars().count() > maximum {
                return Err(QuestionError::InvalidInput);
            }
            Ok(Some(value.to_owned()))
        }
        _ => Ok(None),
    }
}

fn validate_id(value: &str) -> Result<(), QuestionError> {
    Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| QuestionError::InvalidInput)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn region_validation_rejects_canvas_pixels_and_out_of_bounds_rectangles() {
        let result = build_region(
            Uuid::now_v7().to_string(),
            Uuid::now_v7().to_string(),
            Uuid::now_v7().to_string(),
            &QuestionRegionInput {
                page_number: 1,
                x: 120.0,
                y: 80.0,
                width: 300.0,
                height: 100.0,
            },
            0,
            1,
        );

        assert!(matches!(result, Err(QuestionError::InvalidRegion)));
    }

    #[test]
    fn region_validation_accepts_a_normalized_rectangle() {
        let result = build_region(
            Uuid::now_v7().to_string(),
            Uuid::now_v7().to_string(),
            Uuid::now_v7().to_string(),
            &QuestionRegionInput {
                page_number: 2,
                x: 0.1,
                y: 0.2,
                width: 0.5,
                height: 0.3,
            },
            0,
            1,
        );

        assert!(result.is_ok());
    }
}
