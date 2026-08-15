use std::collections::{HashMap, HashSet};

use uuid::Uuid;

use super::{PersistenceError, ReviewDecision, apply_rating, current_utc_millis};
use crate::domain::{
    LocalDate, MistakeProfile, QuestionType, ReviewRating, ReviewSchemeDashboard,
    ReviewSchemeTypeQuota, ReviewState,
};

pub(crate) const REVIEW_SCHEME_POLICY_VERSION: u32 = 2;
const MAX_SCHEME_DOCUMENTS: usize = 50;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReviewSchemeTypeQuotaInput {
    pub(crate) question_type: String,
    pub(crate) quota: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SaveReviewSchemeInput {
    pub(crate) scheme_id: Option<String>,
    pub(crate) name: String,
    pub(crate) subject_id: String,
    pub(crate) all_subject_workbooks: bool,
    pub(crate) daily_quota: u32,
    pub(crate) enabled: bool,
    pub(crate) document_ids: Vec<String>,
    pub(crate) type_quotas: Vec<ReviewSchemeTypeQuotaInput>,
    pub(crate) today: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct GenerateReviewSchemeQueueInput {
    pub(crate) scheme_id: String,
    pub(crate) queue_date: String,
    pub(crate) temporary_document_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SubmitReviewSchemeResultInput {
    pub(crate) queue_id: String,
    pub(crate) question_id: String,
    pub(crate) rating: String,
    pub(crate) today: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct UndoReviewSchemeResultInput {
    pub(crate) queue_id: String,
    pub(crate) today: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ValidatedReviewScheme {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) subject_id: String,
    pub(crate) all_subject_workbooks: bool,
    pub(crate) daily_quota: u32,
    pub(crate) enabled: bool,
    pub(crate) document_ids: Vec<String>,
    pub(crate) type_quotas: Vec<ReviewSchemeTypeQuota>,
    pub(crate) created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ValidatedSchemeSubmission {
    pub(crate) event_id: String,
    pub(crate) attempt_id: String,
    pub(crate) queue_id: String,
    pub(crate) question_id: String,
    pub(crate) rating: ReviewRating,
    pub(crate) today: LocalDate,
    pub(crate) created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReviewSchemeCandidate {
    pub(crate) question_id: String,
    pub(crate) document_id: String,
    pub(crate) question_type: QuestionType,
    pub(crate) due_date: LocalDate,
    pub(crate) last_reviewed_at: Option<i64>,
    pub(crate) last_mistake_at: Option<i64>,
    pub(crate) failure_streak: u32,
    pub(crate) mistake_count: u32,
    pub(crate) days_since_attempt: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReviewSchemeCarryover {
    pub(crate) source_queue_id: String,
    pub(crate) question_id: String,
    pub(crate) document_id: String,
    pub(crate) question_type: QuestionType,
    pub(crate) origin_date: LocalDate,
    pub(crate) origin_position: u32,
    pub(crate) priority_score: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReviewSchemeSelectionKind {
    Carryover,
    Overdue,
    Due,
    New,
}

impl ReviewSchemeSelectionKind {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Carryover => "carryover",
            Self::Overdue => "overdue",
            Self::Due => "due",
            Self::New => "new",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SelectedSchemeQuestion {
    pub(crate) source_queue_id: Option<String>,
    pub(crate) question_id: String,
    pub(crate) question_type: QuestionType,
    pub(crate) origin_date: LocalDate,
    pub(crate) origin_position: u32,
    pub(crate) priority_score: u32,
    pub(crate) selection_kind: ReviewSchemeSelectionKind,
}

/// Stable failures from review-scheme management and generation.
#[derive(Debug, thiserror::Error)]
pub(crate) enum ReviewSchemeError {
    #[error("workspace is not initialized")]
    WorkspaceNotInitialized,
    #[error("review scheme was not found")]
    SchemeNotFound,
    #[error("review scheme conflicts with existing data")]
    SchemeConflict,
    #[error("subject was not found")]
    SubjectNotFound,
    #[error("workbook was not found in the scheme scope")]
    WorkbookNotFound,
    #[error("daily scheme item was not found")]
    QueueItemNotFound,
    #[error("daily scheme item is already completed")]
    QueueItemCompleted,
    #[error("there is no review feedback to undo")]
    UndoUnavailable,
    #[error("review scheme input is invalid")]
    InvalidInput,
    #[error(transparent)]
    Persistence(#[from] PersistenceError),
}

impl ReviewSchemeError {
    pub(crate) const fn code(&self) -> &'static str {
        match self {
            Self::WorkspaceNotInitialized => "WORKSPACE_NOT_INITIALIZED",
            Self::SchemeNotFound => "REVIEW_SCHEME_NOT_FOUND",
            Self::SchemeConflict => "REVIEW_SCHEME_CONFLICT",
            Self::SubjectNotFound => "REVIEW_SCHEME_SUBJECT_NOT_FOUND",
            Self::WorkbookNotFound => "REVIEW_SCHEME_WORKBOOK_NOT_FOUND",
            Self::QueueItemNotFound => "REVIEW_SCHEME_ITEM_NOT_FOUND",
            Self::QueueItemCompleted => "REVIEW_SCHEME_ITEM_COMPLETED",
            Self::UndoUnavailable => "REVIEW_SCHEME_UNDO_UNAVAILABLE",
            Self::InvalidInput => "REVIEW_SCHEME_INPUT_INVALID",
            Self::Persistence(error) => error.code(),
        }
    }
}

pub(crate) trait ReviewSchemeRepository: Clone + Send + Sync + 'static {
    fn dashboard(&self, today: &LocalDate) -> Result<ReviewSchemeDashboard, ReviewSchemeError>;
    fn save_scheme(
        &self,
        scheme: &ValidatedReviewScheme,
        updated_at: i64,
    ) -> Result<(), ReviewSchemeError>;
    fn archive_scheme(&self, scheme_id: &str, archived_at: i64) -> Result<(), ReviewSchemeError>;
    fn set_rest_weekdays(
        &self,
        rest_weekdays: &[u8],
        updated_at: i64,
    ) -> Result<(), ReviewSchemeError>;
    fn generate_queue(
        &self,
        scheme_id: &str,
        queue_date: &LocalDate,
        temporary_document_id: Option<&str>,
        generated_at: i64,
    ) -> Result<(), ReviewSchemeError>;
    fn submit_review(&self, input: &ValidatedSchemeSubmission) -> Result<(), ReviewSchemeError>;
    fn undo_last_review(&self, queue_id: &str) -> Result<(), ReviewSchemeError>;
}

#[derive(Debug, Clone)]
pub(crate) struct ReviewSchemeUseCases<R> {
    repository: R,
}

impl<R: ReviewSchemeRepository> ReviewSchemeUseCases<R> {
    pub(crate) const fn new(repository: R) -> Self {
        Self { repository }
    }

    pub(crate) fn dashboard(
        &self,
        today: &str,
    ) -> Result<ReviewSchemeDashboard, ReviewSchemeError> {
        self.repository.dashboard(&parse_date(today)?)
    }

    pub(crate) fn save_scheme(
        &self,
        input: SaveReviewSchemeInput,
    ) -> Result<ReviewSchemeDashboard, ReviewSchemeError> {
        let today = parse_date(&input.today)?;
        let now = current_utc_millis()?;
        let scheme_id = input
            .scheme_id
            .map(validate_id_owned)
            .transpose()?
            .unwrap_or_else(|| Uuid::now_v7().to_string());
        validate_id(&input.subject_id)?;
        if input.document_ids.len() > MAX_SCHEME_DOCUMENTS {
            return Err(ReviewSchemeError::InvalidInput);
        }
        let mut seen_documents = HashSet::with_capacity(input.document_ids.len());
        for document_id in &input.document_ids {
            validate_id(document_id)?;
            if !seen_documents.insert(document_id.as_str()) {
                return Err(ReviewSchemeError::InvalidInput);
            }
        }
        if !input.all_subject_workbooks && input.document_ids.is_empty() {
            return Err(ReviewSchemeError::InvalidInput);
        }
        if !(1..=100).contains(&input.daily_quota) {
            return Err(ReviewSchemeError::InvalidInput);
        }
        let type_quotas = validate_type_quotas(input.type_quotas, input.daily_quota)?;
        self.repository.save_scheme(
            &ValidatedReviewScheme {
                id: scheme_id,
                name: required_text(&input.name, 80)?,
                subject_id: input.subject_id,
                all_subject_workbooks: input.all_subject_workbooks,
                daily_quota: input.daily_quota,
                enabled: input.enabled,
                document_ids: input.document_ids,
                type_quotas,
                created_at: now,
            },
            now,
        )?;
        self.repository.dashboard(&today)
    }

    pub(crate) fn archive_scheme(
        &self,
        scheme_id: &str,
        today: &str,
    ) -> Result<ReviewSchemeDashboard, ReviewSchemeError> {
        validate_id(scheme_id)?;
        let today = parse_date(today)?;
        self.repository
            .archive_scheme(scheme_id, current_utc_millis()?)?;
        self.repository.dashboard(&today)
    }

    pub(crate) fn set_rest_weekdays(
        &self,
        rest_weekdays: &[u8],
        today: &str,
    ) -> Result<ReviewSchemeDashboard, ReviewSchemeError> {
        let today = parse_date(today)?;
        let mut unique = HashSet::with_capacity(rest_weekdays.len());
        if rest_weekdays.len() >= 7
            || rest_weekdays
                .iter()
                .any(|weekday| *weekday > 6 || !unique.insert(*weekday))
        {
            return Err(ReviewSchemeError::InvalidInput);
        }
        self.repository
            .set_rest_weekdays(rest_weekdays, current_utc_millis()?)?;
        self.repository.dashboard(&today)
    }

    pub(crate) fn generate_queue(
        &self,
        input: &GenerateReviewSchemeQueueInput,
    ) -> Result<ReviewSchemeDashboard, ReviewSchemeError> {
        validate_id(&input.scheme_id)?;
        validate_optional_id(input.temporary_document_id.as_deref())?;
        let queue_date = parse_date(&input.queue_date)?;
        self.repository.generate_queue(
            &input.scheme_id,
            &queue_date,
            input.temporary_document_id.as_deref(),
            current_utc_millis()?,
        )?;
        self.repository.dashboard(&queue_date)
    }

    pub(crate) fn submit_review(
        &self,
        input: &SubmitReviewSchemeResultInput,
    ) -> Result<ReviewSchemeDashboard, ReviewSchemeError> {
        validate_id(&input.queue_id)?;
        validate_id(&input.question_id)?;
        let rating = ReviewRating::parse(&input.rating).ok_or(ReviewSchemeError::InvalidInput)?;
        if rating == ReviewRating::Skipped {
            return Err(ReviewSchemeError::InvalidInput);
        }
        let today = parse_date(&input.today)?;
        self.repository.submit_review(&ValidatedSchemeSubmission {
            event_id: Uuid::now_v7().to_string(),
            attempt_id: Uuid::now_v7().to_string(),
            queue_id: input.queue_id.clone(),
            question_id: input.question_id.clone(),
            rating,
            today: today.clone(),
            created_at: current_utc_millis()?,
        })?;
        self.repository.dashboard(&today)
    }

    pub(crate) fn undo_last_review(
        &self,
        input: &UndoReviewSchemeResultInput,
    ) -> Result<ReviewSchemeDashboard, ReviewSchemeError> {
        validate_id(&input.queue_id)?;
        let today = parse_date(&input.today)?;
        self.repository.undo_last_review(&input.queue_id)?;
        self.repository.dashboard(&today)
    }
}

pub(crate) fn select_scheme_questions(
    carryovers: Vec<ReviewSchemeCarryover>,
    candidates: Vec<ReviewSchemeCandidate>,
    type_quotas: &[ReviewSchemeTypeQuota],
    quota: u32,
    today: &LocalDate,
) -> Vec<SelectedSchemeQuestion> {
    let limit = usize::try_from(quota).unwrap_or(usize::MAX);
    let carryovers = carryovers.into_iter().take(limit).collect::<Vec<_>>();
    let mut selected_documents = carryovers.iter().fold(HashMap::new(), |mut counts, item| {
        *counts.entry(item.document_id.clone()).or_insert(0_u32) += 1;
        counts
    });
    let mut selected = carryovers
        .into_iter()
        .map(|carryover| SelectedSchemeQuestion {
            source_queue_id: Some(carryover.source_queue_id),
            question_id: carryover.question_id,
            question_type: carryover.question_type,
            origin_date: carryover.origin_date,
            origin_position: carryover.origin_position,
            priority_score: carryover.priority_score,
            selection_kind: ReviewSchemeSelectionKind::Carryover,
        })
        .collect::<Vec<_>>();
    if selected.len() >= limit {
        return selected;
    }

    let selected_ids = selected
        .iter()
        .map(|item| item.question_id.as_str())
        .collect::<HashSet<_>>();
    let mut remaining = candidates
        .into_iter()
        .filter(|candidate| !selected_ids.contains(candidate.question_id.as_str()))
        .collect::<Vec<_>>();
    let carried_counts = selected.iter().fold(HashMap::new(), |mut counts, item| {
        *counts.entry(item.question_type).or_insert(0_u32) += 1;
        counts
    });

    for type_quota in type_quotas {
        let wanted = type_quota
            .quota
            .saturating_sub(*carried_counts.get(&type_quota.question_type).unwrap_or(&0));
        for _ in 0..wanted {
            if selected.len() >= limit {
                break;
            }
            let Some(candidate) = take_diverse_candidate(
                &mut remaining,
                Some(type_quota.question_type),
                &selected_documents,
                today,
            ) else {
                break;
            };
            *selected_documents
                .entry(candidate.document_id.clone())
                .or_insert(0) += 1;
            selected.push(selected_candidate(candidate, today, selected.len()));
        }
    }

    while selected.len() < limit {
        let Some(candidate) =
            take_diverse_candidate(&mut remaining, None, &selected_documents, today)
        else {
            break;
        };
        *selected_documents
            .entry(candidate.document_id.clone())
            .or_insert(0) += 1;
        selected.push(selected_candidate(candidate, today, selected.len()));
    }
    selected
}

pub(crate) fn scheme_priority(candidate: &ReviewSchemeCandidate, today: &LocalDate) -> u32 {
    let overdue_days = u32::try_from(today.days_since(&candidate.due_date).max(0))
        .unwrap_or(u32::MAX)
        .min(3650);
    overdue_days.saturating_mul(10_000)
        + candidate.failure_streak.saturating_mul(1_000)
        + candidate.mistake_count.saturating_mul(100)
        + candidate.days_since_attempt.min(365)
}

pub(crate) fn apply_scheme_rating(
    profile: &MistakeProfile,
    state: &ReviewState,
    rating: ReviewRating,
    today: &LocalDate,
    created_at: i64,
    rest_weekdays: &[u8],
) -> Result<ReviewDecision, ReviewSchemeError> {
    let mut decision = apply_rating(profile, state, rating, today, created_at)
        .map_err(|_| ReviewSchemeError::InvalidInput)?;
    decision.next_due_date = add_study_days(today, decision.interval_days, rest_weekdays)?;
    Ok(decision)
}

fn take_diverse_candidate(
    candidates: &mut Vec<ReviewSchemeCandidate>,
    required_type: Option<QuestionType>,
    selected_documents: &HashMap<String, u32>,
    today: &LocalDate,
) -> Option<ReviewSchemeCandidate> {
    let best_score = candidates
        .iter()
        .filter(|candidate| required_type.is_none_or(|value| candidate.question_type == value))
        .map(|candidate| scheme_priority(candidate, today))
        .max()?;
    let threshold = best_score.saturating_sub(100);
    let index = candidates
        .iter()
        .enumerate()
        .filter(|(_, candidate)| {
            required_type.is_none_or(|value| candidate.question_type == value)
                && scheme_priority(candidate, today) >= threshold
        })
        .min_by_key(|(_, candidate)| {
            (
                *selected_documents.get(&candidate.document_id).unwrap_or(&0),
                std::cmp::Reverse(scheme_priority(candidate, today)),
                candidate.question_id.as_str(),
            )
        })?
        .0;
    Some(candidates.remove(index))
}

fn selected_candidate(
    candidate: ReviewSchemeCandidate,
    today: &LocalDate,
    position: usize,
) -> SelectedSchemeQuestion {
    let priority_score = scheme_priority(&candidate, today);
    let selection_kind = if candidate.last_reviewed_at.is_none() {
        ReviewSchemeSelectionKind::New
    } else if candidate.due_date < *today {
        ReviewSchemeSelectionKind::Overdue
    } else {
        ReviewSchemeSelectionKind::Due
    };
    SelectedSchemeQuestion {
        source_queue_id: None,
        question_id: candidate.question_id,
        question_type: candidate.question_type,
        origin_date: today.clone(),
        origin_position: u32::try_from(position).unwrap_or(u32::MAX),
        priority_score,
        selection_kind,
    }
}

fn add_study_days(
    date: &LocalDate,
    count: u32,
    rest_weekdays: &[u8],
) -> Result<LocalDate, ReviewSchemeError> {
    let rest = rest_weekdays.iter().copied().collect::<HashSet<_>>();
    let mut current = date.clone();
    let mut remaining = count;
    while remaining > 0 {
        current = current
            .add_days(1)
            .map_err(|_| ReviewSchemeError::InvalidInput)?;
        if !rest.contains(&current.weekday_from_monday()) {
            remaining -= 1;
        }
    }
    Ok(current)
}

fn validate_type_quotas(
    inputs: Vec<ReviewSchemeTypeQuotaInput>,
    daily_quota: u32,
) -> Result<Vec<ReviewSchemeTypeQuota>, ReviewSchemeError> {
    if inputs.len() != QuestionType::all().len() {
        return Err(ReviewSchemeError::InvalidInput);
    }
    let mut seen = HashSet::with_capacity(inputs.len());
    let mut total = 0_u32;
    let mut quotas = Vec::with_capacity(inputs.len());
    for input in inputs {
        let question_type =
            QuestionType::parse(&input.question_type).ok_or(ReviewSchemeError::InvalidInput)?;
        if !seen.insert(question_type) {
            return Err(ReviewSchemeError::InvalidInput);
        }
        total = total
            .checked_add(input.quota)
            .ok_or(ReviewSchemeError::InvalidInput)?;
        quotas.push(ReviewSchemeTypeQuota {
            question_type,
            quota: input.quota,
        });
    }
    if total != daily_quota {
        return Err(ReviewSchemeError::InvalidInput);
    }
    Ok(quotas)
}

fn required_text(value: &str, maximum: usize) -> Result<String, ReviewSchemeError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > maximum {
        return Err(ReviewSchemeError::InvalidInput);
    }
    Ok(value.to_owned())
}

fn parse_date(value: &str) -> Result<LocalDate, ReviewSchemeError> {
    LocalDate::parse(value.trim()).map_err(|_| ReviewSchemeError::InvalidInput)
}

fn validate_id(value: &str) -> Result<(), ReviewSchemeError> {
    Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| ReviewSchemeError::InvalidInput)
}

fn validate_id_owned(value: String) -> Result<String, ReviewSchemeError> {
    validate_id(&value)?;
    Ok(value)
}

fn validate_optional_id(value: Option<&str>) -> Result<(), ReviewSchemeError> {
    value.map_or(Ok(()), validate_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(value: &str) -> LocalDate {
        LocalDate::parse(value).expect("fixture date should parse")
    }

    fn candidate(id: &str, document: &str, question_type: QuestionType) -> ReviewSchemeCandidate {
        ReviewSchemeCandidate {
            question_id: id.to_owned(),
            document_id: document.to_owned(),
            question_type,
            due_date: date("2026-07-20"),
            last_reviewed_at: Some(1),
            last_mistake_at: Some(1),
            failure_streak: 0,
            mistake_count: 1,
            days_since_attempt: 5,
        }
    }

    #[test]
    fn carryovers_take_quota_before_new_candidates() {
        let carryovers = vec![ReviewSchemeCarryover {
            source_queue_id: "queue".to_owned(),
            question_id: "old".to_owned(),
            document_id: "book-a".to_owned(),
            question_type: QuestionType::Choice,
            origin_date: date("2026-07-19"),
            origin_position: 0,
            priority_score: 10,
        }];
        let selected = select_scheme_questions(
            carryovers,
            vec![candidate("new", "book-b", QuestionType::Blank)],
            &[
                ReviewSchemeTypeQuota {
                    question_type: QuestionType::Choice,
                    quota: 1,
                },
                ReviewSchemeTypeQuota {
                    question_type: QuestionType::Blank,
                    quota: 1,
                },
            ],
            2,
            &date("2026-07-21"),
        );

        assert_eq!(selected[0].question_id, "old");
        assert_eq!(selected.len(), 2);
    }

    #[test]
    fn missing_type_is_filled_from_other_due_types_in_scope() {
        let selected = select_scheme_questions(
            Vec::new(),
            vec![
                candidate("choice-1", "book-a", QuestionType::Choice),
                candidate("choice-2", "book-a", QuestionType::Choice),
            ],
            &[
                ReviewSchemeTypeQuota {
                    question_type: QuestionType::Choice,
                    quota: 1,
                },
                ReviewSchemeTypeQuota {
                    question_type: QuestionType::Blank,
                    quota: 1,
                },
            ],
            2,
            &date("2026-07-21"),
        );

        assert_eq!(selected.len(), 2);
    }

    #[test]
    fn close_priority_candidates_are_spread_across_workbooks() {
        let selected = select_scheme_questions(
            Vec::new(),
            vec![
                candidate("a-1", "book-a", QuestionType::Choice),
                candidate("a-2", "book-a", QuestionType::Choice),
                candidate("b-1", "book-b", QuestionType::Choice),
            ],
            &[ReviewSchemeTypeQuota {
                question_type: QuestionType::Choice,
                quota: 2,
            }],
            2,
            &date("2026-07-21"),
        );
        let ids = selected
            .iter()
            .map(|item| item.question_id.as_str())
            .collect::<HashSet<_>>();

        assert_eq!(ids, HashSet::from(["a-1", "b-1"]));
    }

    #[test]
    fn study_day_interval_skips_weekly_rest_day() {
        let next =
            add_study_days(&date("2026-07-25"), 1, &[6]).expect("study date should calculate");

        assert_eq!(next.as_str(), "2026-07-27");
    }
}
