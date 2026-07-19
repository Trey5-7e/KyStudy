use uuid::Uuid;

use super::{PersistenceError, current_utc_millis};
use crate::domain::{
    DateRange, LocalDate, PlanReference, PlanStage, PlanStatus, StudyPlan, StudyPlanBundle,
};

/// Editable fields for creating or updating one plan.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SavePlanInput {
    pub(crate) id: Option<String>,
    pub(crate) title: String,
    pub(crate) target_exam: Option<String>,
    pub(crate) exam_date: Option<String>,
    pub(crate) overview: Option<String>,
}

/// Editable fields for creating or updating one plan stage.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SavePlanStageInput {
    pub(crate) id: Option<String>,
    pub(crate) plan_id: String,
    pub(crate) title: String,
    pub(crate) start_date: String,
    pub(crate) end_date: String,
    pub(crate) focus: Option<String>,
    pub(crate) sort_order: u32,
}

/// One page range selected as evidence for a personal plan.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AddPlanReferenceInput {
    pub(crate) plan_id: String,
    pub(crate) document_id: String,
    pub(crate) page_start: u32,
    pub(crate) page_end: u32,
    pub(crate) note: Option<String>,
}

/// Stable planning failures safe to map to command error codes.
#[derive(Debug, thiserror::Error)]
pub(crate) enum PlanningError {
    #[error("workspace is not initialized")]
    WorkspaceNotInitialized,
    #[error("planning input is invalid")]
    InvalidInput,
    #[error("study plan was not found")]
    PlanNotFound,
    #[error("plan stage was not found")]
    StageNotFound,
    #[error("plan reference was not found")]
    ReferenceNotFound,
    #[error("the referenced PDF or page range is invalid")]
    InvalidReference,
    #[error(transparent)]
    Persistence(#[from] PersistenceError),
}

impl PlanningError {
    /// Returns a stable non-sensitive command code.
    pub(crate) const fn code(&self) -> &'static str {
        match self {
            Self::WorkspaceNotInitialized => "WORKSPACE_NOT_INITIALIZED",
            Self::InvalidInput => "PLAN_INPUT_INVALID",
            Self::PlanNotFound => "PLAN_NOT_FOUND",
            Self::StageNotFound => "PLAN_STAGE_NOT_FOUND",
            Self::ReferenceNotFound => "PLAN_REFERENCE_NOT_FOUND",
            Self::InvalidReference => "PLAN_REFERENCE_INVALID",
            Self::Persistence(error) => error.code(),
        }
    }
}

/// Persistence operations required by manual plan editing.
pub(crate) trait PlanningRepository: Clone + Send + Sync + 'static {
    fn list_plans(&self) -> Result<Vec<StudyPlanBundle>, PlanningError>;
    fn save_plan(&self, plan: StudyPlan) -> Result<StudyPlanBundle, PlanningError>;
    fn set_plan_status(
        &self,
        plan_id: &str,
        status: PlanStatus,
        updated_at: i64,
    ) -> Result<StudyPlanBundle, PlanningError>;
    fn save_stage(&self, stage: PlanStage) -> Result<PlanStage, PlanningError>;
    fn delete_stage(&self, stage_id: &str) -> Result<(), PlanningError>;
    fn add_reference(&self, reference: PlanReference) -> Result<PlanReference, PlanningError>;
    fn delete_reference(&self, reference_id: &str) -> Result<(), PlanningError>;
}

/// Manual personal-planning use cases with explicit confirmation transitions.
#[derive(Debug, Clone)]
pub(crate) struct PlanningUseCases<R> {
    repository: R,
}

impl<R: PlanningRepository> PlanningUseCases<R> {
    pub(crate) const fn new(repository: R) -> Self {
        Self { repository }
    }

    pub(crate) fn list(&self) -> Result<Vec<StudyPlanBundle>, PlanningError> {
        self.repository.list_plans()
    }

    pub(crate) fn save_plan(&self, input: SavePlanInput) -> Result<StudyPlanBundle, PlanningError> {
        let now = current_utc_millis()?;
        let title = required_text(&input.title, 120)?;
        let target_exam = optional_text(input.target_exam, 120)?;
        let overview = optional_text(input.overview, 8000)?;
        let exam_date = match input.exam_date {
            Some(value) if !value.trim().is_empty() => Some(
                LocalDate::parse(value.trim())
                    .map_err(|_| PlanningError::InvalidInput)?
                    .as_str()
                    .to_owned(),
            ),
            _ => None,
        };
        let id = input.id.unwrap_or_else(|| Uuid::now_v7().to_string());
        if !is_identifier(&id) {
            return Err(PlanningError::InvalidInput);
        }
        self.repository.save_plan(StudyPlan {
            id,
            title,
            target_exam,
            exam_date,
            overview,
            status: PlanStatus::Draft,
            revision: 1,
            created_at: now,
            updated_at: now,
        })
    }

    pub(crate) fn set_status(
        &self,
        plan_id: &str,
        status: &str,
    ) -> Result<StudyPlanBundle, PlanningError> {
        if !is_identifier(plan_id) {
            return Err(PlanningError::InvalidInput);
        }
        let status = PlanStatus::parse(status).ok_or(PlanningError::InvalidInput)?;
        self.repository
            .set_plan_status(plan_id, status, current_utc_millis()?)
    }

    pub(crate) fn save_stage(&self, input: SavePlanStageInput) -> Result<PlanStage, PlanningError> {
        if !is_identifier(&input.plan_id) {
            return Err(PlanningError::InvalidInput);
        }
        let start =
            LocalDate::parse(input.start_date.trim()).map_err(|_| PlanningError::InvalidInput)?;
        let end =
            LocalDate::parse(input.end_date.trim()).map_err(|_| PlanningError::InvalidInput)?;
        DateRange::new(start.clone(), end.clone()).map_err(|_| PlanningError::InvalidInput)?;
        let id = input.id.unwrap_or_else(|| Uuid::now_v7().to_string());
        if !is_identifier(&id) {
            return Err(PlanningError::InvalidInput);
        }
        let now = current_utc_millis()?;
        self.repository.save_stage(PlanStage {
            id,
            plan_id: input.plan_id,
            title: required_text(&input.title, 120)?,
            start_date: start.as_str().to_owned(),
            end_date: end.as_str().to_owned(),
            focus: optional_text(input.focus, 4000)?,
            sort_order: input.sort_order,
            created_at: now,
            updated_at: now,
        })
    }

    pub(crate) fn delete_stage(&self, stage_id: &str) -> Result<(), PlanningError> {
        if !is_identifier(stage_id) {
            return Err(PlanningError::InvalidInput);
        }
        self.repository.delete_stage(stage_id)
    }

    pub(crate) fn add_reference(
        &self,
        input: AddPlanReferenceInput,
    ) -> Result<PlanReference, PlanningError> {
        if !is_identifier(&input.plan_id)
            || !is_identifier(&input.document_id)
            || input.page_start == 0
            || input.page_end < input.page_start
        {
            return Err(PlanningError::InvalidReference);
        }
        self.repository.add_reference(PlanReference {
            id: Uuid::now_v7().to_string(),
            plan_id: input.plan_id,
            document_id: input.document_id,
            document_title: String::new(),
            page_start: input.page_start,
            page_end: input.page_end,
            note: optional_text(input.note, 1000)?,
            created_at: current_utc_millis()?,
        })
    }

    pub(crate) fn delete_reference(&self, reference_id: &str) -> Result<(), PlanningError> {
        if !is_identifier(reference_id) {
            return Err(PlanningError::InvalidInput);
        }
        self.repository.delete_reference(reference_id)
    }
}

fn required_text(value: &str, maximum: usize) -> Result<String, PlanningError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > maximum {
        return Err(PlanningError::InvalidInput);
    }
    Ok(value.to_owned())
}

fn optional_text(value: Option<String>, maximum: usize) -> Result<Option<String>, PlanningError> {
    match value {
        Some(value) if !value.trim().is_empty() => {
            let value = value.trim();
            if value.chars().count() > maximum {
                return Err(PlanningError::InvalidInput);
            }
            Ok(Some(value.to_owned()))
        }
        _ => Ok(None),
    }
}

fn is_identifier(value: &str) -> bool {
    Uuid::parse_str(value).is_ok()
}

#[cfg(test)]
mod tests {
    use super::{optional_text, required_text};

    #[test]
    fn text_fields_are_trimmed_before_persistence() {
        assert_eq!(
            required_text("  强化阶段  ", 120).expect("valid required text should parse"),
            "强化阶段"
        );
        assert_eq!(
            optional_text(Some("  408  ".to_owned()), 120)
                .expect("valid optional text should parse"),
            Some("408".to_owned())
        );
    }
}
