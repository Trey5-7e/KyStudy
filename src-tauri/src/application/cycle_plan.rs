use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::{PersistenceError, current_utc_millis};
use crate::domain::{
    CyclePlan, CyclePlanDashboard, CyclePlanItem, CyclePlanItemState, CyclePlanOverview,
    CycleScheduleMode, LocalDate, ScheduleValidationError,
};

const MAX_PLAN_DAYS: i64 = 1_095;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SaveCyclePlanInput {
    pub(crate) plan_id: Option<String>,
    pub(crate) expected_updated_at: Option<i64>,
    pub(crate) name: String,
    pub(crate) total_units: u32,
    pub(crate) unit_label: String,
    pub(crate) start_date: String,
    pub(crate) deadline: String,
    pub(crate) study_days_per_unit: u32,
    pub(crate) schedule_mode: String,
    pub(crate) calendar_visible: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ShiftCyclePlanInput {
    pub(crate) plan_id: String,
    pub(crate) from_date: String,
    pub(crate) study_days: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ConfirmShiftCyclePlanInput {
    pub(crate) plan_id: String,
    pub(crate) from_date: String,
    pub(crate) study_days: u32,
    pub(crate) preview_token: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ValidatedShiftCyclePlanIntent {
    pub(crate) plan_id: String,
    pub(crate) from_date: LocalDate,
    pub(crate) study_days: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ShiftCyclePlanPreview {
    pub(crate) plan_id: String,
    pub(crate) from_date: LocalDate,
    pub(crate) study_days: u32,
    pub(crate) affected_item_count: u32,
    pub(crate) current_estimated_end_date: LocalDate,
    pub(crate) new_estimated_end_date: LocalDate,
    pub(crate) deadline: LocalDate,
    pub(crate) exceeds_deadline_by_days: u32,
    pub(crate) rest_weekdays: Vec<u8>,
    pub(crate) preview_token: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ShiftProjection {
    pub(crate) preview: ShiftCyclePlanPreview,
    pub(crate) shifted_items: Vec<ShiftedCyclePlanItem>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ConfirmedShiftMutation {
    pub(crate) shifted_item_count: u32,
    pub(crate) undo: Option<ShiftCyclePlanUndo>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct UndoShiftCyclePlanInput {
    pub(crate) plan_id: String,
    pub(crate) undo_token: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ShiftCyclePlanUndo {
    pub(crate) plan_id: String,
    pub(crate) undo_token: String,
    pub(crate) expires_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ShiftedCyclePlanItem {
    pub(crate) before: CyclePlanItem,
    pub(crate) after: CyclePlanItem,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ShiftCyclePlanResult {
    pub(crate) dashboard: CyclePlanDashboard,
    pub(crate) shifted_item_count: u32,
    pub(crate) undo: Option<ShiftCyclePlanUndo>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SetCyclePlanItemStateInput {
    pub(crate) item_id: String,
    pub(crate) target_state: String,
    pub(crate) expected_updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SetCyclePlanItemStateResult {
    pub(crate) dashboard: CyclePlanDashboard,
    pub(crate) item_id: String,
    pub(crate) item_updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RestoreCyclePlanItemStateInput {
    pub(crate) item_id: String,
    pub(crate) original_state: String,
    pub(crate) original_completed_at: Option<i64>,
    pub(crate) original_skipped_at: Option<i64>,
    pub(crate) expected_updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct GeneratedCyclePlanItem {
    pub(crate) id: String,
    pub(crate) unit_index: u32,
    pub(crate) start_date: LocalDate,
    pub(crate) end_date: LocalDate,
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum CyclePlanError {
    #[error("workspace is not initialized")]
    WorkspaceNotInitialized,
    #[error("cycle plan was not found")]
    PlanNotFound,
    #[error("cycle plan item was not found")]
    ItemNotFound,
    #[error("cycle plan input is invalid")]
    InvalidInput,
    #[error("cycle plan item state changed before the operation completed")]
    ItemStateStale,
    #[error("cycle plan shift undo is unavailable")]
    ShiftUndoUnavailable,
    #[error("cycle plan shift undo conflicts with a newer change")]
    ShiftUndoStale,
    #[error("cycle plan shift preview conflicts with the current plan")]
    ShiftPreviewStale,
    #[error("cycle plan was changed before the save completed")]
    SaveStale,
    #[error("completed progress conflicts with the new total")]
    CompletedProgressConflict,
    #[error(transparent)]
    Validation(#[from] ScheduleValidationError),
    #[error(transparent)]
    Persistence(#[from] PersistenceError),
}

impl CyclePlanError {
    pub(crate) const fn code(&self) -> &'static str {
        match self {
            Self::WorkspaceNotInitialized => "WORKSPACE_NOT_INITIALIZED",
            Self::PlanNotFound => "CYCLE_PLAN_NOT_FOUND",
            Self::ItemNotFound => "CYCLE_PLAN_ITEM_NOT_FOUND",
            Self::InvalidInput | Self::Validation(_) => "CYCLE_PLAN_INPUT_INVALID",
            Self::ItemStateStale => "CYCLE_PLAN_ITEM_STATE_STALE",
            Self::ShiftUndoUnavailable => "CYCLE_PLAN_SHIFT_UNDO_UNAVAILABLE",
            Self::ShiftUndoStale => "CYCLE_PLAN_SHIFT_UNDO_STALE",
            Self::ShiftPreviewStale => "CYCLE_PLAN_SHIFT_PREVIEW_STALE",
            Self::SaveStale => "CYCLE_PLAN_SAVE_STALE",
            Self::CompletedProgressConflict => "CYCLE_PLAN_COMPLETED_CONFLICT",
            Self::Persistence(error) => error.code(),
        }
    }
}

pub(crate) trait CyclePlanRepository: Clone + Send + Sync + 'static {
    fn rest_weekdays(&self) -> Result<Vec<u8>, CyclePlanError>;
    fn load_plans(&self) -> Result<Vec<(CyclePlan, Vec<CyclePlanItem>)>, CyclePlanError>;
    fn save_plan(
        &self,
        plan: &CyclePlan,
        generated: &[GeneratedCyclePlanItem],
        expected_updated_at: Option<i64>,
    ) -> Result<(), CyclePlanError>;
    fn preview_shift(
        &self,
        intent: &ValidatedShiftCyclePlanIntent,
    ) -> Result<ShiftCyclePlanPreview, CyclePlanError>;
    fn confirm_shift(
        &self,
        intent: &ValidatedShiftCyclePlanIntent,
        preview_token: &str,
        now: i64,
    ) -> Result<ConfirmedShiftMutation, CyclePlanError>;
    fn undo_shifted_items(
        &self,
        plan_id: &str,
        undo_token: &str,
        now: i64,
    ) -> Result<(), CyclePlanError>;
    fn transition_item_state(
        &self,
        item_id: &str,
        target_state: CyclePlanItemState,
        completed_at: Option<i64>,
        skipped_at: Option<i64>,
        expected_updated_at: i64,
        updated_at: i64,
    ) -> Result<(), CyclePlanError>;
    fn restore_item_state(
        &self,
        item_id: &str,
        original_state: CyclePlanItemState,
        original_completed_at: Option<i64>,
        original_skipped_at: Option<i64>,
        expected_updated_at: i64,
        updated_at: i64,
    ) -> Result<(), CyclePlanError>;
    fn archive_plan(
        &self,
        plan_id: &str,
        expected_updated_at: i64,
        archived_at: i64,
    ) -> Result<(), CyclePlanError>;
}

#[derive(Debug, Clone)]
pub(crate) struct CyclePlanUseCases<R> {
    repository: R,
}

impl<R: CyclePlanRepository> CyclePlanUseCases<R> {
    pub(crate) const fn new(repository: R) -> Self {
        Self { repository }
    }

    pub(crate) fn dashboard(&self) -> Result<CyclePlanDashboard, CyclePlanError> {
        let rest_weekdays = self.repository.rest_weekdays()?;
        let plans = self
            .repository
            .load_plans()?
            .into_iter()
            .map(|(plan, items)| overview(plan, items, &rest_weekdays))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(CyclePlanDashboard {
            rest_weekdays,
            plans,
        })
    }

    pub(crate) fn save_plan(
        &self,
        input: &SaveCyclePlanInput,
    ) -> Result<CyclePlanDashboard, CyclePlanError> {
        let now = current_utc_millis()?;
        if input.plan_id.is_some() != input.expected_updated_at.is_some()
            || input
                .expected_updated_at
                .is_some_and(|version| version <= 0)
        {
            return Err(CyclePlanError::InvalidInput);
        }
        let id = input
            .plan_id
            .as_deref()
            .map(validate_id)
            .transpose()?
            .map_or_else(|| Uuid::now_v7().to_string(), str::to_owned);
        let start_date = LocalDate::parse(input.start_date.trim())?;
        let deadline = LocalDate::parse(input.deadline.trim())?;
        let span = deadline.days_since(&start_date);
        if !(0..=MAX_PLAN_DAYS).contains(&span)
            || !(1..=500).contains(&input.total_units)
            || !(1..=30).contains(&input.study_days_per_unit)
        {
            return Err(CyclePlanError::InvalidInput);
        }
        let schedule_mode =
            CycleScheduleMode::parse(&input.schedule_mode).ok_or(CyclePlanError::InvalidInput)?;
        let plan = CyclePlan {
            id,
            name: required_text(&input.name, 120)?,
            total_units: input.total_units,
            unit_label: required_text(&input.unit_label, 20)?,
            start_date,
            deadline,
            study_days_per_unit: input.study_days_per_unit,
            schedule_mode,
            calendar_visible: input.calendar_visible,
            created_at: now,
            updated_at: now,
        };
        let rest_weekdays = self.repository.rest_weekdays()?;
        let generated = build_schedule(&plan, &rest_weekdays)?;
        self.repository
            .save_plan(&plan, &generated, input.expected_updated_at)?;
        self.dashboard()
    }

    pub(crate) fn set_item_state(
        &self,
        input: &SetCyclePlanItemStateInput,
    ) -> Result<SetCyclePlanItemStateResult, CyclePlanError> {
        validate_id(&input.item_id)?;
        if input.expected_updated_at <= 0 {
            return Err(CyclePlanError::InvalidInput);
        }
        let target_state =
            CyclePlanItemState::parse(&input.target_state).ok_or(CyclePlanError::InvalidInput)?;
        let updated_at = next_item_updated_at(input.expected_updated_at)?;
        self.repository.transition_item_state(
            &input.item_id,
            target_state,
            (target_state == CyclePlanItemState::Completed).then_some(updated_at),
            (target_state == CyclePlanItemState::Skipped).then_some(updated_at),
            input.expected_updated_at,
            updated_at,
        )?;
        Ok(SetCyclePlanItemStateResult {
            dashboard: self.dashboard()?,
            item_id: input.item_id.clone(),
            item_updated_at: updated_at,
        })
    }

    pub(crate) fn restore_item_state(
        &self,
        input: &RestoreCyclePlanItemStateInput,
    ) -> Result<CyclePlanDashboard, CyclePlanError> {
        validate_id(&input.item_id)?;
        let original_state =
            CyclePlanItemState::parse(&input.original_state).ok_or(CyclePlanError::InvalidInput)?;
        if input.expected_updated_at <= 0
            || !valid_state_timestamps(
                original_state,
                input.original_completed_at,
                input.original_skipped_at,
            )
        {
            return Err(CyclePlanError::InvalidInput);
        }
        let updated_at = next_item_updated_at(input.expected_updated_at)?;
        self.repository.restore_item_state(
            &input.item_id,
            original_state,
            input.original_completed_at,
            input.original_skipped_at,
            input.expected_updated_at,
            updated_at,
        )?;
        self.dashboard()
    }

    pub(crate) fn preview_shift_plan(
        &self,
        input: &ShiftCyclePlanInput,
    ) -> Result<ShiftCyclePlanPreview, CyclePlanError> {
        self.repository.preview_shift(&validate_shift_intent(
            &input.plan_id,
            &input.from_date,
            input.study_days,
        )?)
    }

    pub(crate) fn confirm_shift_plan(
        &self,
        input: &ConfirmShiftCyclePlanInput,
    ) -> Result<ShiftCyclePlanResult, CyclePlanError> {
        let intent = validate_shift_intent(&input.plan_id, &input.from_date, input.study_days)?;
        validate_preview_token(&input.preview_token)?;
        let mutation =
            self.repository
                .confirm_shift(&intent, &input.preview_token, current_utc_millis()?)?;
        let dashboard = self.dashboard()?;
        Ok(ShiftCyclePlanResult {
            dashboard,
            shifted_item_count: mutation.shifted_item_count,
            undo: mutation.undo,
        })
    }

    pub(crate) fn undo_shift_plan(
        &self,
        input: &UndoShiftCyclePlanInput,
    ) -> Result<CyclePlanDashboard, CyclePlanError> {
        validate_id(&input.plan_id)?;
        validate_undo_token(&input.undo_token)?;
        self.repository.undo_shifted_items(
            &input.plan_id,
            &input.undo_token,
            current_utc_millis()?,
        )?;
        self.dashboard()
    }

    pub(crate) fn archive_plan(
        &self,
        plan_id: &str,
        expected_updated_at: i64,
    ) -> Result<CyclePlanDashboard, CyclePlanError> {
        validate_id(plan_id)?;
        self.repository
            .archive_plan(plan_id, expected_updated_at, current_utc_millis()?)?;
        self.dashboard()
    }

    pub(crate) fn refresh_schedules(&self) -> Result<CyclePlanDashboard, CyclePlanError> {
        let rest_weekdays = self.repository.rest_weekdays()?;
        for (mut plan, _) in self.repository.load_plans()? {
            let expected_updated_at = plan.updated_at;
            plan.updated_at = current_utc_millis()?;
            let generated = build_schedule(&plan, &rest_weekdays)?;
            self.repository
                .save_plan(&plan, &generated, Some(expected_updated_at))?;
        }
        self.dashboard()
    }
}

fn validate_shift_intent(
    plan_id: &str,
    from_date: &str,
    study_days: u32,
) -> Result<ValidatedShiftCyclePlanIntent, CyclePlanError> {
    validate_id(plan_id)?;
    if !(1..=30).contains(&study_days) {
        return Err(CyclePlanError::InvalidInput);
    }
    Ok(ValidatedShiftCyclePlanIntent {
        plan_id: plan_id.to_owned(),
        from_date: LocalDate::parse(from_date.trim())?,
        study_days,
    })
}

fn valid_state_timestamps(
    state: CyclePlanItemState,
    completed_at: Option<i64>,
    skipped_at: Option<i64>,
) -> bool {
    if completed_at.is_some_and(|value| value < 0) || skipped_at.is_some_and(|value| value < 0) {
        return false;
    }
    match state {
        CyclePlanItemState::Pending => completed_at.is_none() && skipped_at.is_none(),
        CyclePlanItemState::Completed => completed_at.is_some() && skipped_at.is_none(),
        CyclePlanItemState::Skipped => completed_at.is_none() && skipped_at.is_some(),
    }
}

const PREVIEW_TOKEN_PREFIX: &str = "cpsp1_";
const PREVIEW_TOKEN_HEX_LENGTH: usize = 64;

fn validate_preview_token(value: &str) -> Result<&str, CyclePlanError> {
    let Some(hex) = value.strip_prefix(PREVIEW_TOKEN_PREFIX) else {
        return Err(CyclePlanError::InvalidInput);
    };
    if hex.len() != PREVIEW_TOKEN_HEX_LENGTH
        || !hex
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(CyclePlanError::InvalidInput);
    }
    Ok(value)
}

pub(crate) fn build_shift_projection(
    workspace_id: &str,
    plan: &CyclePlan,
    items: &[CyclePlanItem],
    rest_weekdays: &[u8],
    intent: &ValidatedShiftCyclePlanIntent,
) -> Result<ShiftProjection, CyclePlanError> {
    validate_rest_weekdays(rest_weekdays)?;
    let mut normalized_rest_weekdays = rest_weekdays.to_vec();
    normalized_rest_weekdays.sort_unstable();
    let shifted_items = items
        .iter()
        .filter(|item| {
            item.state == CyclePlanItemState::Pending && item.planned_end_date >= intent.from_date
        })
        .map(|item| {
            let mut after = item.clone();
            after.planned_start_date = study_day_at(
                &item.planned_start_date,
                intent.study_days,
                &normalized_rest_weekdays,
            )?;
            after.planned_end_date = study_day_at(
                &item.planned_end_date,
                intent.study_days,
                &normalized_rest_weekdays,
            )?;
            after.shift_count = item.shift_count.saturating_add(intent.study_days);
            Ok(ShiftedCyclePlanItem {
                before: item.clone(),
                after,
            })
        })
        .collect::<Result<Vec<_>, CyclePlanError>>()?;
    let current_estimated_end_date = estimated_end_date(items)?;
    let new_estimated_end_date = items
        .iter()
        .map(|item| {
            shifted_items
                .iter()
                .find(|shifted| shifted.before.id == item.id)
                .map_or_else(
                    || item.planned_end_date.clone(),
                    |shifted| shifted.after.planned_end_date.clone(),
                )
        })
        .max()
        .ok_or(CyclePlanError::InvalidInput)?;
    let affected_item_count =
        u32::try_from(shifted_items.len()).map_err(|_| CyclePlanError::InvalidInput)?;
    let exceeds_deadline_by_days =
        u32::try_from(new_estimated_end_date.days_since(&plan.deadline).max(0))
            .map_err(|_| CyclePlanError::InvalidInput)?;
    let preview_token = (!shifted_items.is_empty()).then(|| {
        shift_preview_fingerprint(
            workspace_id,
            plan,
            items,
            &normalized_rest_weekdays,
            intent,
            &shifted_items,
        )
    });
    Ok(ShiftProjection {
        preview: ShiftCyclePlanPreview {
            plan_id: plan.id.clone(),
            from_date: intent.from_date.clone(),
            study_days: intent.study_days,
            affected_item_count,
            current_estimated_end_date,
            new_estimated_end_date,
            deadline: plan.deadline.clone(),
            exceeds_deadline_by_days,
            rest_weekdays: normalized_rest_weekdays,
            preview_token,
        },
        shifted_items,
    })
}

fn estimated_end_date(items: &[CyclePlanItem]) -> Result<LocalDate, CyclePlanError> {
    items
        .iter()
        .map(|item| item.planned_end_date.clone())
        .max()
        .ok_or(CyclePlanError::InvalidInput)
}

fn shift_preview_fingerprint(
    workspace_id: &str,
    plan: &CyclePlan,
    items: &[CyclePlanItem],
    rest_weekdays: &[u8],
    intent: &ValidatedShiftCyclePlanIntent,
    shifted_items: &[ShiftedCyclePlanItem],
) -> String {
    let mut hasher = Sha256::new();
    hash_text(&mut hasher, "kystudy:cycle-plan-shift-preview:v1");
    hash_text(&mut hasher, workspace_id);
    hash_plan(&mut hasher, plan);
    hash_text(&mut hasher, intent.from_date.as_str());
    hasher.update(intent.study_days.to_be_bytes());
    hash_length(&mut hasher, rest_weekdays.len());
    hasher.update(rest_weekdays);
    let mut ordered_items = items.iter().collect::<Vec<_>>();
    ordered_items.sort_unstable_by(|left, right| {
        (left.unit_index, &left.id).cmp(&(right.unit_index, &right.id))
    });
    hash_length(&mut hasher, ordered_items.len());
    for item in ordered_items {
        hash_item(&mut hasher, item);
    }
    let mut ordered_shifts = shifted_items.iter().collect::<Vec<_>>();
    ordered_shifts.sort_unstable_by(|left, right| {
        (left.before.unit_index, &left.before.id).cmp(&(right.before.unit_index, &right.before.id))
    });
    hash_length(&mut hasher, ordered_shifts.len());
    for shifted in ordered_shifts {
        hash_text(&mut hasher, &shifted.after.id);
        hash_text(&mut hasher, shifted.after.planned_start_date.as_str());
        hash_text(&mut hasher, shifted.after.planned_end_date.as_str());
        hasher.update(shifted.after.shift_count.to_be_bytes());
    }
    format!("{PREVIEW_TOKEN_PREFIX}{:x}", hasher.finalize())
}

fn hash_plan(hasher: &mut Sha256, plan: &CyclePlan) {
    hash_text(hasher, &plan.id);
    hash_text(hasher, &plan.name);
    hasher.update(plan.total_units.to_be_bytes());
    hash_text(hasher, &plan.unit_label);
    hash_text(hasher, plan.start_date.as_str());
    hash_text(hasher, plan.deadline.as_str());
    hasher.update(plan.study_days_per_unit.to_be_bytes());
    hash_text(hasher, plan.schedule_mode.as_str());
    hasher.update([u8::from(plan.calendar_visible)]);
    hasher.update(plan.created_at.to_be_bytes());
    hasher.update(plan.updated_at.to_be_bytes());
}

fn hash_item(hasher: &mut Sha256, item: &CyclePlanItem) {
    hash_text(hasher, &item.id);
    hash_text(hasher, &item.plan_id);
    hasher.update(item.unit_index.to_be_bytes());
    hash_text(hasher, item.planned_start_date.as_str());
    hash_text(hasher, item.planned_end_date.as_str());
    hash_text(hasher, item.original_start_date.as_str());
    hash_text(hasher, item.original_end_date.as_str());
    hash_text(hasher, item.state.as_str());
    match item.completed_at {
        Some(completed_at) => {
            hasher.update([1]);
            hasher.update(completed_at.to_be_bytes());
        }
        None => hasher.update([0]),
    }
    match item.skipped_at {
        Some(skipped_at) => {
            hasher.update([1]);
            hasher.update(skipped_at.to_be_bytes());
        }
        None => hasher.update([0]),
    }
    hasher.update(item.shift_count.to_be_bytes());
    hasher.update(item.created_at.to_be_bytes());
    hasher.update(item.updated_at.to_be_bytes());
}

fn hash_text(hasher: &mut Sha256, value: &str) {
    hash_length(hasher, value.len());
    hasher.update(value.as_bytes());
}

fn hash_length(hasher: &mut Sha256, value: usize) {
    hasher.update(u64::try_from(value).unwrap_or(u64::MAX).to_be_bytes());
}

pub(crate) fn build_schedule(
    plan: &CyclePlan,
    rest_weekdays: &[u8],
) -> Result<Vec<GeneratedCyclePlanItem>, CyclePlanError> {
    validate_rest_weekdays(rest_weekdays)?;
    match plan.schedule_mode {
        CycleScheduleMode::Rhythm => (0..plan.total_units)
            .map(|index| {
                let start_offset = index
                    .checked_mul(plan.study_days_per_unit)
                    .ok_or(CyclePlanError::InvalidInput)?;
                let start_date = study_day_at(&plan.start_date, start_offset, rest_weekdays)?;
                let end_date = study_day_at(
                    &start_date,
                    plan.study_days_per_unit.saturating_sub(1),
                    rest_weekdays,
                )?;
                Ok(GeneratedCyclePlanItem {
                    id: Uuid::now_v7().to_string(),
                    unit_index: index + 1,
                    start_date,
                    end_date,
                })
            })
            .collect(),
        CycleScheduleMode::Even => {
            let study_days = study_days_between(&plan.start_date, &plan.deadline, rest_weekdays)?;
            if study_days.is_empty() {
                return Err(CyclePlanError::InvalidInput);
            }
            let denominator = plan.total_units.saturating_sub(1);
            (0..plan.total_units)
                .map(|index| {
                    let maximum = u32::try_from(study_days.len() - 1)
                        .map_err(|_| CyclePlanError::InvalidInput)?;
                    let completion_index = (index * maximum + denominator / 2)
                        .checked_div(denominator)
                        .unwrap_or(0);
                    let end_date = study_days
                        .get(
                            usize::try_from(completion_index)
                                .map_err(|_| CyclePlanError::InvalidInput)?,
                        )
                        .ok_or(CyclePlanError::InvalidInput)?
                        .clone();
                    let start_date = retreat_study_days(
                        &end_date,
                        plan.study_days_per_unit.saturating_sub(1),
                        &plan.start_date,
                        rest_weekdays,
                    )?;
                    Ok(GeneratedCyclePlanItem {
                        id: Uuid::now_v7().to_string(),
                        unit_index: index + 1,
                        start_date,
                        end_date,
                    })
                })
                .collect()
        }
    }
}

fn overview(
    plan: CyclePlan,
    items: Vec<CyclePlanItem>,
    rest_weekdays: &[u8],
) -> Result<CyclePlanOverview, CyclePlanError> {
    let completed_count = u32::try_from(
        items
            .iter()
            .filter(|item| item.state.as_str() == "completed")
            .count(),
    )
    .map_err(|_| CyclePlanError::InvalidInput)?;
    let skipped_count = u32::try_from(
        items
            .iter()
            .filter(|item| item.state == CyclePlanItemState::Skipped)
            .count(),
    )
    .map_err(|_| CyclePlanError::InvalidInput)?;
    let estimated_end_date = items
        .iter()
        .map(|item| item.planned_end_date.clone())
        .max()
        .ok_or(CyclePlanError::InvalidInput)?;
    let exceeds_deadline = estimated_end_date > plan.deadline;
    let available =
        u32::try_from(study_days_between(&plan.start_date, &plan.deadline, rest_weekdays)?.len())
            .map_err(|_| CyclePlanError::InvalidInput)?;
    Ok(CyclePlanOverview {
        progress_percent: completed_count.saturating_mul(100) / plan.total_units,
        recommended_study_days_per_unit: exceeds_deadline
            .then(|| (available / plan.total_units).max(1)),
        recommended_total_units: exceeds_deadline.then(|| {
            (available / plan.study_days_per_unit)
                .max(completed_count)
                .max(1)
        }),
        plan,
        items,
        completed_count,
        skipped_count,
        estimated_end_date,
        exceeds_deadline,
    })
}

fn study_day_at(
    start: &LocalDate,
    index: u32,
    rest_weekdays: &[u8],
) -> Result<LocalDate, CyclePlanError> {
    let mut date = start.clone();
    let mut found = 0_u32;
    loop {
        if !rest_weekdays.contains(&date.weekday_from_monday()) {
            if found == index {
                return Ok(date);
            }
            found = found.saturating_add(1);
        }
        date = date.add_days(1)?;
    }
}

fn retreat_study_days(
    end: &LocalDate,
    count: u32,
    lower_bound: &LocalDate,
    rest_weekdays: &[u8],
) -> Result<LocalDate, CyclePlanError> {
    let mut date = end.clone();
    let mut remaining = count;
    while remaining > 0 && date > *lower_bound {
        date = date.subtract_days(1)?;
        if !rest_weekdays.contains(&date.weekday_from_monday()) {
            remaining -= 1;
        }
    }
    Ok(date.max(lower_bound.clone()))
}

fn study_days_between(
    start: &LocalDate,
    end: &LocalDate,
    rest_weekdays: &[u8],
) -> Result<Vec<LocalDate>, CyclePlanError> {
    let span = end.days_since(start);
    if !(0..=MAX_PLAN_DAYS).contains(&span) {
        return Err(CyclePlanError::InvalidInput);
    }
    (0..=u32::try_from(span).map_err(|_| CyclePlanError::InvalidInput)?)
        .map(|offset| start.add_days(offset))
        .filter_map(|date| match date {
            Ok(date) if !rest_weekdays.contains(&date.weekday_from_monday()) => Some(Ok(date)),
            Ok(_) => None,
            Err(error) => Some(Err(CyclePlanError::from(error))),
        })
        .collect()
}

fn validate_rest_weekdays(values: &[u8]) -> Result<(), CyclePlanError> {
    if values.len() >= 7 || values.iter().any(|value| *value > 6) {
        return Err(CyclePlanError::InvalidInput);
    }
    let mut unique = [false; 7];
    for value in values {
        let slot = &mut unique[usize::from(*value)];
        if *slot {
            return Err(CyclePlanError::InvalidInput);
        }
        *slot = true;
    }
    Ok(())
}

fn validate_id(value: &str) -> Result<&str, CyclePlanError> {
    Uuid::parse_str(value)
        .map(|_| value)
        .map_err(|_| CyclePlanError::InvalidInput)
}

const MAX_UNDO_TOKEN_LENGTH: usize = 128;

fn validate_undo_token(value: &str) -> Result<&str, CyclePlanError> {
    if value.is_empty()
        || value.len() > MAX_UNDO_TOKEN_LENGTH
        || value.chars().any(char::is_control)
    {
        return Err(CyclePlanError::InvalidInput);
    }
    Ok(value)
}

fn required_text(value: &str, maximum: usize) -> Result<String, CyclePlanError> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.chars().count() > maximum {
        return Err(CyclePlanError::InvalidInput);
    }
    Ok(trimmed.to_owned())
}

fn next_item_updated_at(expected_updated_at: i64) -> Result<i64, CyclePlanError> {
    let minimum = expected_updated_at
        .checked_add(1)
        .ok_or(CyclePlanError::InvalidInput)?;
    Ok(current_utc_millis()?.max(minimum))
}

pub(crate) const SHIFT_UNDO_WINDOW_MS: i64 = 5_000;

pub(crate) fn next_monotonic_updated_at(
    now: i64,
    items: &[ShiftedCyclePlanItem],
) -> Result<i64, CyclePlanError> {
    items.iter().try_fold(now, |updated_at, item| {
        item.before
            .updated_at
            .checked_add(1)
            .map(|minimum| updated_at.max(minimum))
            .ok_or(CyclePlanError::InvalidInput)
    })
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::{
        ConfirmedShiftMutation, CyclePlanError, CyclePlanRepository, CyclePlanUseCases,
        GeneratedCyclePlanItem, MAX_UNDO_TOKEN_LENGTH, PREVIEW_TOKEN_HEX_LENGTH,
        PREVIEW_TOKEN_PREFIX, SetCyclePlanItemStateInput, ShiftCyclePlanPreview,
        ValidatedShiftCyclePlanIntent, build_schedule, build_shift_projection, overview,
        validate_undo_token,
    };
    use crate::domain::{
        CyclePlan, CyclePlanItem, CyclePlanItemState, CycleScheduleMode, LocalDate,
    };

    #[derive(Debug, Default)]
    struct DashboardRaceState {
        completed_at: Option<i64>,
        written_updated_at: Option<i64>,
    }

    #[derive(Debug, Clone, Default)]
    struct DashboardRaceRepository {
        state: Arc<Mutex<DashboardRaceState>>,
    }

    impl DashboardRaceRepository {
        fn written_updated_at(&self) -> i64 {
            self.state
                .lock()
                .expect("race state should lock")
                .written_updated_at
                .expect("write version should be captured")
        }
    }

    impl CyclePlanRepository for DashboardRaceRepository {
        fn rest_weekdays(&self) -> Result<Vec<u8>, CyclePlanError> {
            Ok(Vec::new())
        }

        fn load_plans(&self) -> Result<Vec<(CyclePlan, Vec<CyclePlanItem>)>, CyclePlanError> {
            let state = self.state.lock().expect("race state should lock");
            let written_updated_at = state
                .written_updated_at
                .expect("dashboard should load after the write");
            let mut value = plan(CycleScheduleMode::Rhythm);
            value.total_units = 1;
            let date = LocalDate::parse("2026-07-29").expect("date should parse");
            Ok(vec![(
                value.clone(),
                vec![CyclePlanItem {
                    id: "00000000-0000-7000-8000-000000000002".to_owned(),
                    plan_id: value.id,
                    unit_index: 1,
                    planned_start_date: date.clone(),
                    planned_end_date: date.clone(),
                    original_start_date: date.clone(),
                    original_end_date: date,
                    state: CyclePlanItemState::Completed,
                    completed_at: state.completed_at,
                    skipped_at: None,
                    shift_count: 0,
                    created_at: 1,
                    updated_at: written_updated_at.saturating_add(1),
                }],
            )])
        }

        fn save_plan(
            &self,
            _plan: &CyclePlan,
            _generated: &[GeneratedCyclePlanItem],
            _expected_updated_at: Option<i64>,
        ) -> Result<(), CyclePlanError> {
            Err(CyclePlanError::InvalidInput)
        }

        fn preview_shift(
            &self,
            _intent: &ValidatedShiftCyclePlanIntent,
        ) -> Result<ShiftCyclePlanPreview, CyclePlanError> {
            Err(CyclePlanError::InvalidInput)
        }

        fn confirm_shift(
            &self,
            _intent: &ValidatedShiftCyclePlanIntent,
            _preview_token: &str,
            _now: i64,
        ) -> Result<ConfirmedShiftMutation, CyclePlanError> {
            Err(CyclePlanError::InvalidInput)
        }

        fn undo_shifted_items(
            &self,
            _plan_id: &str,
            _undo_token: &str,
            _now: i64,
        ) -> Result<(), CyclePlanError> {
            Err(CyclePlanError::InvalidInput)
        }

        fn transition_item_state(
            &self,
            _item_id: &str,
            _target_state: CyclePlanItemState,
            completed_at: Option<i64>,
            _skipped_at: Option<i64>,
            _expected_updated_at: i64,
            updated_at: i64,
        ) -> Result<(), CyclePlanError> {
            let mut state = self.state.lock().expect("race state should lock");
            state.completed_at = completed_at;
            state.written_updated_at = Some(updated_at);
            Ok(())
        }

        fn restore_item_state(
            &self,
            _item_id: &str,
            _original_state: CyclePlanItemState,
            _original_completed_at: Option<i64>,
            _original_skipped_at: Option<i64>,
            _expected_updated_at: i64,
            _updated_at: i64,
        ) -> Result<(), CyclePlanError> {
            Err(CyclePlanError::InvalidInput)
        }

        fn archive_plan(
            &self,
            _plan_id: &str,
            _expected_updated_at: i64,
            _archived_at: i64,
        ) -> Result<(), CyclePlanError> {
            Err(CyclePlanError::InvalidInput)
        }
    }

    fn plan(mode: CycleScheduleMode) -> CyclePlan {
        CyclePlan {
            id: "00000000-0000-7000-8000-000000000001".to_owned(),
            name: "20 套模拟卷".to_owned(),
            total_units: 20,
            unit_label: "套".to_owned(),
            start_date: LocalDate::parse("2026-07-29").unwrap(),
            deadline: LocalDate::parse("2026-09-30").unwrap(),
            study_days_per_unit: 2,
            schedule_mode: mode,
            calendar_visible: true,
            created_at: 1,
            updated_at: 1,
        }
    }

    #[test]
    fn rhythm_schedule_skips_rest_days_and_uses_two_day_spans() {
        let items = build_schedule(&plan(CycleScheduleMode::Rhythm), &[6]).unwrap();

        assert_eq!(items.len(), 20);
        assert_eq!(items[0].start_date.as_str(), "2026-07-29");
        assert_eq!(items[0].end_date.as_str(), "2026-07-30");
        assert_eq!(items[1].start_date.as_str(), "2026-07-31");
    }

    #[test]
    fn shift_preview_fingerprint_is_canonical_and_binds_authoritative_state() {
        let mut value = plan(CycleScheduleMode::Rhythm);
        value.total_units = 2;
        let items = build_schedule(&value, &[5, 6])
            .expect("schedule should build")
            .into_iter()
            .map(|generated| CyclePlanItem {
                id: generated.id,
                plan_id: value.id.clone(),
                unit_index: generated.unit_index,
                planned_start_date: generated.start_date.clone(),
                planned_end_date: generated.end_date.clone(),
                original_start_date: generated.start_date,
                original_end_date: generated.end_date,
                state: CyclePlanItemState::Pending,
                completed_at: None,
                skipped_at: None,
                shift_count: 0,
                created_at: 1,
                updated_at: 1,
            })
            .collect::<Vec<_>>();
        let intent = ValidatedShiftCyclePlanIntent {
            plan_id: value.id.clone(),
            from_date: value.start_date.clone(),
            study_days: 1,
        };
        let first = build_shift_projection("workspace", &value, &items, &[6, 5], &intent)
            .expect("preview should build");
        let mut reversed = items.clone();
        reversed.reverse();
        let reordered = build_shift_projection("workspace", &value, &reversed, &[5, 6], &intent)
            .expect("reordered preview should build");
        let token = first
            .preview
            .preview_token
            .as_deref()
            .expect("affected preview should have a token");
        assert_eq!(first.preview.preview_token, reordered.preview.preview_token);
        assert_eq!(first.preview.rest_weekdays, vec![5, 6]);
        assert_eq!(
            token.len(),
            PREVIEW_TOKEN_PREFIX.len() + PREVIEW_TOKEN_HEX_LENGTH
        );
        assert!(token.starts_with(PREVIEW_TOKEN_PREFIX));
        assert!(
            token[PREVIEW_TOKEN_PREFIX.len()..]
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        );

        let mut changed_plan = value.clone();
        changed_plan.updated_at += 1;
        let changed = build_shift_projection("workspace", &changed_plan, &items, &[5, 6], &intent)
            .expect("changed preview should build");
        assert_ne!(first.preview.preview_token, changed.preview.preview_token);
        let mut changed_items = items;
        changed_items[0].original_start_date = LocalDate::parse("2026-07-28").unwrap();
        let changed = build_shift_projection("workspace", &value, &changed_items, &[5, 6], &intent)
            .expect("changed item preview should build");
        assert_ne!(first.preview.preview_token, changed.preview.preview_token);
    }

    #[test]
    fn overdue_overview_offers_faster_or_smaller_replan_values() {
        let mut value = plan(CycleScheduleMode::Rhythm);
        value.deadline = LocalDate::parse("2026-08-10").unwrap();
        let generated = build_schedule(&value, &[6]).unwrap();
        let items = generated
            .into_iter()
            .map(|item| CyclePlanItem {
                id: item.id,
                plan_id: value.id.clone(),
                unit_index: item.unit_index,
                planned_start_date: item.start_date.clone(),
                planned_end_date: item.end_date.clone(),
                original_start_date: item.start_date,
                original_end_date: item.end_date,
                state: CyclePlanItemState::Pending,
                completed_at: None,
                skipped_at: None,
                shift_count: 0,
                created_at: 1,
                updated_at: 1,
            })
            .collect();
        let summary = overview(value, items, &[6]).unwrap();

        assert!(summary.exceeds_deadline);
        assert_eq!(summary.recommended_study_days_per_unit, Some(1));
        assert!(summary.recommended_total_units.unwrap() < 20);
    }

    #[test]
    fn set_item_state_returns_write_token_when_dashboard_has_a_later_version() {
        let repository = DashboardRaceRepository::default();
        let use_cases = CyclePlanUseCases::new(repository.clone());

        let result = use_cases
            .set_item_state(&SetCyclePlanItemStateInput {
                item_id: "00000000-0000-7000-8000-000000000002".to_owned(),
                target_state: "completed".to_owned(),
                expected_updated_at: 1,
            })
            .expect("item should complete");

        assert_eq!(result.item_updated_at, repository.written_updated_at());
        assert!(result.dashboard.plans[0].items[0].updated_at > result.item_updated_at);
    }

    #[test]
    fn undo_token_validation_accepts_non_uuid_opaque_values() {
        assert!(validate_undo_token("opaque-shift-token").is_ok());
        assert!(matches!(
            validate_undo_token(""),
            Err(CyclePlanError::InvalidInput)
        ));
        assert!(matches!(
            validate_undo_token(&"x".repeat(MAX_UNDO_TOKEN_LENGTH + 1)),
            Err(CyclePlanError::InvalidInput)
        ));
    }
}
