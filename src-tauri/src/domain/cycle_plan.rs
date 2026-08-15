use super::LocalDate;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CycleScheduleMode {
    Rhythm,
    Even,
}

impl CycleScheduleMode {
    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "rhythm" => Some(Self::Rhythm),
            "even" => Some(Self::Even),
            _ => None,
        }
    }

    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Rhythm => "rhythm",
            Self::Even => "even",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CyclePlanItemState {
    Pending,
    Completed,
    Skipped,
}

impl CyclePlanItemState {
    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "pending" => Some(Self::Pending),
            "completed" => Some(Self::Completed),
            "skipped" => Some(Self::Skipped),
            _ => None,
        }
    }

    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Completed => "completed",
            Self::Skipped => "skipped",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CyclePlan {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) total_units: u32,
    pub(crate) unit_label: String,
    pub(crate) start_date: LocalDate,
    pub(crate) deadline: LocalDate,
    pub(crate) study_days_per_unit: u32,
    pub(crate) schedule_mode: CycleScheduleMode,
    pub(crate) calendar_visible: bool,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CyclePlanItem {
    pub(crate) id: String,
    pub(crate) plan_id: String,
    pub(crate) unit_index: u32,
    pub(crate) planned_start_date: LocalDate,
    pub(crate) planned_end_date: LocalDate,
    pub(crate) original_start_date: LocalDate,
    pub(crate) original_end_date: LocalDate,
    pub(crate) state: CyclePlanItemState,
    pub(crate) completed_at: Option<i64>,
    pub(crate) skipped_at: Option<i64>,
    pub(crate) shift_count: u32,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CyclePlanOverview {
    pub(crate) plan: CyclePlan,
    pub(crate) items: Vec<CyclePlanItem>,
    pub(crate) completed_count: u32,
    pub(crate) skipped_count: u32,
    pub(crate) progress_percent: u32,
    pub(crate) estimated_end_date: LocalDate,
    pub(crate) exceeds_deadline: bool,
    pub(crate) recommended_study_days_per_unit: Option<u32>,
    pub(crate) recommended_total_units: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CyclePlanDashboard {
    pub(crate) rest_weekdays: Vec<u8>,
    pub(crate) plans: Vec<CyclePlanOverview>,
}
