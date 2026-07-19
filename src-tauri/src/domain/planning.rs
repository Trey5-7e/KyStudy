/// User-controlled lifecycle for a personal study plan.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PlanStatus {
    Draft,
    Active,
    Archived,
}

impl PlanStatus {
    /// Parses a stable command and storage token.
    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "draft" => Some(Self::Draft),
            "active" => Some(Self::Active),
            "archived" => Some(Self::Archived),
            _ => None,
        }
    }

    /// Returns the stable command and storage token.
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Active => "active",
            Self::Archived => "archived",
        }
    }
}

/// One editable or confirmed personal study plan.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StudyPlan {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) target_exam: Option<String>,
    pub(crate) exam_date: Option<String>,
    pub(crate) overview: Option<String>,
    pub(crate) status: PlanStatus,
    pub(crate) revision: u32,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
}

/// One ordered phase within a study plan.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PlanStage {
    pub(crate) id: String,
    pub(crate) plan_id: String,
    pub(crate) title: String,
    pub(crate) start_date: String,
    pub(crate) end_date: String,
    pub(crate) focus: Option<String>,
    pub(crate) sort_order: u32,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
}

/// One page-range citation from a plan to an imported PDF.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PlanReference {
    pub(crate) id: String,
    pub(crate) plan_id: String,
    pub(crate) document_id: String,
    pub(crate) document_title: String,
    pub(crate) page_start: u32,
    pub(crate) page_end: u32,
    pub(crate) note: Option<String>,
    pub(crate) created_at: i64,
}

/// A plan returned with its ordered stages and page references.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StudyPlanBundle {
    pub(crate) plan: StudyPlan,
    pub(crate) stages: Vec<PlanStage>,
    pub(crate) references: Vec<PlanReference>,
}
