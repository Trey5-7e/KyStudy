use uuid::Uuid;

/// Validation failures for schedule values before persistence.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub(crate) enum ScheduleValidationError {
    /// A user-facing title or name is empty or too long.
    #[error("schedule text length is invalid")]
    Text,
    /// A local calendar date is not a real `YYYY-MM-DD` value.
    #[error("local calendar date is invalid")]
    Date,
    /// The end of a requested date range precedes its start.
    #[error("schedule date range is invalid")]
    DateRange,
    /// Estimated minutes are outside the supported daily range.
    #[error("estimated minutes are invalid")]
    EstimatedMinutes,
    /// Actual study duration is outside the supported daily range.
    #[error("study duration is invalid")]
    DurationMinutes,
    /// A reported completion percentage is outside zero through one hundred.
    #[error("study completion percentage is invalid")]
    CompletionPercent,
    /// A timestamp cannot represent a persisted event.
    #[error("schedule timestamp is invalid")]
    Timestamp,
    /// A referenced local identifier is malformed.
    #[error("schedule identifier is invalid")]
    Identifier,
    /// A task transition is not valid from the current state.
    #[error("task transition is invalid")]
    Transition,
    /// A task split does not contain a safe number of valid children.
    #[error("task split is invalid")]
    Split,
    /// A study record references inconsistent task and subject data.
    #[error("study association is invalid")]
    Association,
}

/// One validated local calendar date with lexical chronological ordering.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct LocalDate(String);

impl LocalDate {
    /// Parses one strict Gregorian `YYYY-MM-DD` value.
    pub(crate) fn parse(value: &str) -> Result<Self, ScheduleValidationError> {
        let bytes = value.as_bytes();
        if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
            return Err(ScheduleValidationError::Date);
        }
        let year = parse_digits(&bytes[0..4]).ok_or(ScheduleValidationError::Date)?;
        let month = parse_digits(&bytes[5..7]).ok_or(ScheduleValidationError::Date)?;
        let day = parse_digits(&bytes[8..10]).ok_or(ScheduleValidationError::Date)?;
        if year == 0 || !(1..=12).contains(&month) || day == 0 || day > days_in_month(year, month) {
            return Err(ScheduleValidationError::Date);
        }
        Ok(Self(value.to_owned()))
    }

    /// Returns the stable database and DTO representation.
    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }

    /// Returns the signed number of calendar days from `earlier` to this date.
    pub(crate) fn days_since(&self, earlier: &Self) -> i64 {
        days_from_civil(self.components()) - days_from_civil(earlier.components())
    }

    /// Returns Monday as zero through Sunday as six.
    pub(crate) fn weekday_from_monday(&self) -> u8 {
        u8::try_from((days_from_civil(self.components()) + 3).rem_euclid(7)).unwrap_or_default()
    }

    /// Moves this date forward by a bounded number of calendar days.
    pub(crate) fn add_days(&self, days: u32) -> Result<Self, ScheduleValidationError> {
        let target = days_from_civil(self.components()) + i64::from(days);
        let (year, month, day) = civil_from_days(target).ok_or(ScheduleValidationError::Date)?;
        Self::parse(&format!("{year:04}-{month:02}-{day:02}"))
    }

    /// Moves this date backward by a bounded number of calendar days.
    pub(crate) fn subtract_days(&self, days: u32) -> Result<Self, ScheduleValidationError> {
        let target = days_from_civil(self.components()) - i64::from(days);
        let (year, month, day) = civil_from_days(target).ok_or(ScheduleValidationError::Date)?;
        Self::parse(&format!("{year:04}-{month:02}-{day:02}"))
    }

    fn components(&self) -> (i64, i64, i64) {
        let bytes = self.0.as_bytes();
        (
            i64::from(parse_digits(&bytes[0..4]).unwrap_or_default()),
            i64::from(parse_digits(&bytes[5..7]).unwrap_or_default()),
            i64::from(parse_digits(&bytes[8..10]).unwrap_or_default()),
        )
    }
}

fn days_from_civil((mut year, month, day): (i64, i64, i64)) -> i64 {
    year -= i64::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let adjusted_month = month + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * adjusted_month + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

fn civil_from_days(mut days: i64) -> Option<(i64, i64, i64)> {
    days += 719_468;
    let era = if days >= 0 { days } else { days - 146_096 } / 146_097;
    let day_of_era = days - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    (1..=9_999).contains(&year).then_some((year, month, day))
}

/// Inclusive validated date range used by list queries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DateRange {
    pub(crate) start: LocalDate,
    pub(crate) end: LocalDate,
}

impl DateRange {
    /// Builds an inclusive range whose end cannot precede its start.
    pub(crate) fn new(start: LocalDate, end: LocalDate) -> Result<Self, ScheduleValidationError> {
        if end < start {
            return Err(ScheduleValidationError::DateRange);
        }
        Ok(Self { start, end })
    }
}

/// Controlled subject color token interpreted by the UI theme.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SubjectColor {
    Slate,
    Blue,
    Cyan,
    Green,
    Amber,
    Orange,
    Rose,
    Purple,
}

impl SubjectColor {
    /// Parses a color token without accepting arbitrary CSS.
    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "slate" => Some(Self::Slate),
            "blue" => Some(Self::Blue),
            "cyan" => Some(Self::Cyan),
            "green" => Some(Self::Green),
            "amber" => Some(Self::Amber),
            "orange" => Some(Self::Orange),
            "rose" => Some(Self::Rose),
            "purple" => Some(Self::Purple),
            _ => None,
        }
    }

    /// Returns the stable storage token.
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Slate => "slate",
            Self::Blue => "blue",
            Self::Cyan => "cyan",
            Self::Green => "green",
            Self::Amber => "amber",
            Self::Orange => "orange",
            Self::Rose => "rose",
            Self::Purple => "purple",
        }
    }
}

/// User-controlled task priority.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TaskPriority {
    Low,
    Normal,
    High,
}

impl TaskPriority {
    /// Parses a stable priority token.
    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "low" => Some(Self::Low),
            "normal" => Some(Self::Normal),
            "high" => Some(Self::High),
            _ => None,
        }
    }

    /// Returns the stable storage token.
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Normal => "normal",
            Self::High => "high",
        }
    }
}

/// Persisted task lifecycle state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TaskStatus {
    Todo,
    InProgress,
    Done,
    Canceled,
}

impl TaskStatus {
    /// Parses a stable status token read from storage.
    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "todo" => Some(Self::Todo),
            "in_progress" => Some(Self::InProgress),
            "done" => Some(Self::Done),
            "canceled" => Some(Self::Canceled),
            _ => None,
        }
    }

    /// Returns the stable storage token.
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Todo => "todo",
            Self::InProgress => "in_progress",
            Self::Done => "done",
            Self::Canceled => "canceled",
        }
    }
}

/// First supported task state changes exposed by the minimum vertical slice.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TaskTransition {
    Start,
    Complete,
    Reopen,
    Cancel,
    Restore,
}

impl TaskTransition {
    /// Parses one transition token accepted by the command boundary.
    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "start" => Some(Self::Start),
            "complete" => Some(Self::Complete),
            "reopen" => Some(Self::Reopen),
            "cancel" => Some(Self::Cancel),
            "restore" => Some(Self::Restore),
            _ => None,
        }
    }
}

/// Stable kinds stored for immutable task changes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TaskChangeType {
    Created,
    Edited,
    Rescheduled,
    Started,
    Completed,
    Reopened,
    Canceled,
    Restored,
    Split,
    Trashed,
}

impl TaskChangeType {
    /// Parses one task change token read from storage.
    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "created" => Some(Self::Created),
            "edited" => Some(Self::Edited),
            "rescheduled" => Some(Self::Rescheduled),
            "started" => Some(Self::Started),
            "completed" => Some(Self::Completed),
            "reopened" => Some(Self::Reopened),
            "canceled" => Some(Self::Canceled),
            "restored" => Some(Self::Restored),
            "split" => Some(Self::Split),
            "trashed" => Some(Self::Trashed),
            _ => None,
        }
    }

    /// Returns the stable command DTO token.
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Created => "created",
            Self::Edited => "edited",
            Self::Rescheduled => "rescheduled",
            Self::Started => "started",
            Self::Completed => "completed",
            Self::Reopened => "reopened",
            Self::Canceled => "canceled",
            Self::Restored => "restored",
            Self::Split => "split",
            Self::Trashed => "trashed",
        }
    }
}

/// Validated fields used to create one manual task.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TaskDraft {
    pub(crate) subject_id: Option<String>,
    pub(crate) title: String,
    pub(crate) description: Option<String>,
    pub(crate) planned_date: LocalDate,
    pub(crate) estimated_minutes: Option<u32>,
    pub(crate) priority: TaskPriority,
    pub(crate) manual_order: u32,
}

impl TaskDraft {
    /// Validates and normalizes user-authored task fields.
    pub(crate) fn new(
        subject_id: Option<String>,
        title: &str,
        description: Option<&str>,
        planned_date: LocalDate,
        estimated_minutes: Option<u32>,
        priority: TaskPriority,
        manual_order: u32,
    ) -> Result<Self, ScheduleValidationError> {
        let subject_id = normalize_subject_id(subject_id)?;
        let title = normalize_task_title(title)?;
        let description = normalize_task_description(description)?;
        validate_estimated_minutes(estimated_minutes)?;
        Ok(Self {
            subject_id,
            title,
            description,
            planned_date,
            estimated_minutes,
            priority,
            manual_order,
        })
    }
}

/// Validated editable fields that deliberately exclude a task's planned date.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TaskDetailsDraft {
    pub(crate) subject_id: Option<String>,
    pub(crate) title: String,
    pub(crate) description: Option<String>,
    pub(crate) estimated_minutes: Option<u32>,
    pub(crate) priority: TaskPriority,
}

impl TaskDetailsDraft {
    /// Validates and normalizes the fields editable from task details.
    pub(crate) fn new(
        subject_id: Option<String>,
        title: &str,
        description: Option<&str>,
        estimated_minutes: Option<u32>,
        priority: TaskPriority,
    ) -> Result<Self, ScheduleValidationError> {
        let subject_id = normalize_subject_id(subject_id)?;
        let title = normalize_task_title(title)?;
        let description = normalize_task_description(description)?;
        validate_estimated_minutes(estimated_minutes)?;
        Ok(Self {
            subject_id,
            title,
            description,
            estimated_minutes,
            priority,
        })
    }
}

/// Validated date and reason for one explicit task reschedule.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RescheduleDraft {
    pub(crate) planned_date: LocalDate,
    pub(crate) reason: String,
}

/// One validated child requested by an explicit task split.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SplitChildDraft {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) description: Option<String>,
    pub(crate) estimated_minutes: Option<u32>,
}

impl SplitChildDraft {
    /// Validates child-specific fields while leaving inherited fields to the parent task.
    pub(crate) fn new(
        title: &str,
        description: Option<&str>,
        estimated_minutes: Option<u32>,
    ) -> Result<Self, ScheduleValidationError> {
        let title = normalize_task_title(title)?;
        let description = normalize_task_description(description)?;
        validate_estimated_minutes(estimated_minutes)?;
        Ok(Self {
            id: Uuid::now_v7().to_string(),
            title,
            description,
            estimated_minutes,
        })
    }
}

/// Validated children and timestamp for one atomic task split.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SplitTaskDraft {
    pub(crate) children: Vec<SplitChildDraft>,
    pub(crate) created_at: i64,
}

impl SplitTaskDraft {
    /// Requires between two and twenty child tasks.
    pub(crate) fn new(
        children: Vec<SplitChildDraft>,
        created_at: i64,
    ) -> Result<Self, ScheduleValidationError> {
        if !(2..=20).contains(&children.len()) {
            return Err(ScheduleValidationError::Split);
        }
        validate_timestamp(created_at)?;
        Ok(Self {
            children,
            created_at,
        })
    }
}

impl RescheduleDraft {
    /// Creates a reschedule request with a concise, non-empty reason.
    pub(crate) fn new(
        planned_date: LocalDate,
        reason: &str,
    ) -> Result<Self, ScheduleValidationError> {
        let reason = reason.trim().to_owned();
        if reason.is_empty() || reason.chars().count() > 500 {
            return Err(ScheduleValidationError::Text);
        }
        Ok(Self {
            planned_date,
            reason,
        })
    }
}

/// New subject ready for one transactional insert.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NewSubject {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) color: SubjectColor,
    pub(crate) sort_order: u32,
    pub(crate) created_at: i64,
}

impl NewSubject {
    /// Creates a normalized subject with an offline `UUIDv7` identifier.
    pub(crate) fn new(
        name: &str,
        color: SubjectColor,
        sort_order: u32,
        created_at: i64,
    ) -> Result<Self, ScheduleValidationError> {
        let name = name.trim().to_owned();
        if name.is_empty() || name.chars().count() > 40 {
            return Err(ScheduleValidationError::Text);
        }
        validate_timestamp(created_at)?;
        Ok(Self {
            id: Uuid::now_v7().to_string(),
            name,
            color,
            sort_order,
            created_at,
        })
    }
}

/// Subject metadata safe for application and command DTOs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Subject {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) color: SubjectColor,
    pub(crate) sort_order: u32,
    pub(crate) archived_at: Option<i64>,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
}

impl Subject {
    /// Archives an active subject without modifying tasks already assigned to it.
    pub(crate) fn archive(&mut self, archived_at: i64) -> Result<bool, ScheduleValidationError> {
        validate_change_timestamp(archived_at, self.updated_at)?;
        if self.archived_at.is_some() {
            return Ok(false);
        }
        self.archived_at = Some(archived_at);
        self.updated_at = archived_at;
        Ok(true)
    }
}

/// New manual task ready for one transactional insert.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NewTask {
    pub(crate) id: String,
    pub(crate) draft: TaskDraft,
    pub(crate) created_at: i64,
}

impl NewTask {
    /// Assigns an offline `UUIDv7` identifier to validated task fields.
    pub(crate) fn manual(
        draft: TaskDraft,
        created_at: i64,
    ) -> Result<Self, ScheduleValidationError> {
        validate_timestamp(created_at)?;
        Ok(Self {
            id: Uuid::now_v7().to_string(),
            draft,
            created_at,
        })
    }
}

/// Formal task returned without persistence internals.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Task {
    pub(crate) id: String,
    pub(crate) subject_id: Option<String>,
    pub(crate) parent_task_id: Option<String>,
    pub(crate) title: String,
    pub(crate) description: Option<String>,
    pub(crate) planned_date: LocalDate,
    pub(crate) estimated_minutes: Option<u32>,
    pub(crate) priority: TaskPriority,
    pub(crate) status: TaskStatus,
    pub(crate) manual_order: u32,
    pub(crate) completed_at: Option<i64>,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
}

/// Parent and children returned after one successful atomic split.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TaskSplit {
    pub(crate) parent: Task,
    pub(crate) children: Vec<Task>,
}

/// A soft-deleted task returned by the controlled recycle-bin use case.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TrashedTask {
    pub(crate) task: Task,
    pub(crate) deleted_at: i64,
}

/// One manually recorded actual study session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NewStudySession {
    pub(crate) id: String,
    pub(crate) task_id: Option<String>,
    pub(crate) subject_id: Option<String>,
    pub(crate) session_date: LocalDate,
    pub(crate) duration_minutes: u32,
    pub(crate) completion_percent: u32,
    pub(crate) reflection: Option<String>,
    pub(crate) created_at: i64,
}

impl NewStudySession {
    /// Validates one manual record without modifying any task estimate.
    pub(crate) fn new(
        task_id: Option<String>,
        subject_id: Option<String>,
        session_date: LocalDate,
        duration_minutes: u32,
        completion_percent: u32,
        reflection: Option<&str>,
        created_at: i64,
    ) -> Result<Self, ScheduleValidationError> {
        let task_id = normalize_optional_id(task_id)?;
        let subject_id = normalize_optional_id(subject_id)?;
        if !(1..=1_440).contains(&duration_minutes) {
            return Err(ScheduleValidationError::DurationMinutes);
        }
        if completion_percent > 100 {
            return Err(ScheduleValidationError::CompletionPercent);
        }
        let reflection = normalize_task_description(reflection)?;
        validate_timestamp(created_at)?;
        Ok(Self {
            id: Uuid::now_v7().to_string(),
            task_id,
            subject_id,
            session_date,
            duration_minutes,
            completion_percent,
            reflection,
            created_at,
        })
    }
}

/// Actual study data returned without persistence internals.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StudySession {
    pub(crate) id: String,
    pub(crate) task_id: Option<String>,
    pub(crate) subject_id: Option<String>,
    pub(crate) session_date: LocalDate,
    pub(crate) duration_minutes: u32,
    pub(crate) completion_percent: u32,
    pub(crate) reflection: Option<String>,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
}

/// Per-subject values used by the basic planning statistics view.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SubjectStatistics {
    pub(crate) subject_id: Option<String>,
    pub(crate) subject_name: String,
    pub(crate) color: SubjectColor,
    pub(crate) task_count: u32,
    pub(crate) actual_minutes: u32,
}

/// Stable aggregate values for one explicit local-date range.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StudyStatistics {
    pub(crate) task_count: u32,
    pub(crate) completed_task_count: u32,
    pub(crate) completion_rate_percent: Option<u32>,
    pub(crate) planned_minutes: u32,
    pub(crate) actual_minutes: u32,
    pub(crate) minute_difference: i64,
    pub(crate) overdue_task_count: u32,
    pub(crate) subjects: Vec<SubjectStatistics>,
}

/// Explicit task fields returned for one readable history snapshot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TaskChangeSnapshot {
    pub(crate) subject_id: Option<String>,
    pub(crate) title: String,
    pub(crate) description: Option<String>,
    pub(crate) planned_date: LocalDate,
    pub(crate) estimated_minutes: Option<u32>,
    pub(crate) priority: TaskPriority,
    pub(crate) status: TaskStatus,
    pub(crate) manual_order: u32,
    pub(crate) completed_at: Option<i64>,
}

impl From<&Task> for TaskChangeSnapshot {
    fn from(task: &Task) -> Self {
        Self {
            subject_id: task.subject_id.clone(),
            title: task.title.clone(),
            description: task.description.clone(),
            planned_date: task.planned_date.clone(),
            estimated_minutes: task.estimated_minutes,
            priority: task.priority,
            status: task.status,
            manual_order: task.manual_order,
            completed_at: task.completed_at,
        }
    }
}

/// One immutable task change with typed snapshots instead of raw audit JSON.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TaskChange {
    pub(crate) id: String,
    pub(crate) task_id: String,
    pub(crate) change_type: TaskChangeType,
    pub(crate) before: Option<TaskChangeSnapshot>,
    pub(crate) after: Option<TaskChangeSnapshot>,
    pub(crate) reason: Option<String>,
    pub(crate) created_at: i64,
}

impl Task {
    /// Updates editable details while preserving schedule date and lifecycle state.
    pub(crate) fn update_details(
        &mut self,
        details: TaskDetailsDraft,
        changed_at: i64,
    ) -> Result<bool, ScheduleValidationError> {
        validate_change_timestamp(changed_at, self.updated_at)?;
        let changed = self.subject_id != details.subject_id
            || self.title != details.title
            || self.description != details.description
            || self.estimated_minutes != details.estimated_minutes
            || self.priority != details.priority;
        if !changed {
            return Ok(false);
        }
        self.subject_id = details.subject_id;
        self.title = details.title;
        self.description = details.description;
        self.estimated_minutes = details.estimated_minutes;
        self.priority = details.priority;
        self.updated_at = changed_at;
        Ok(true)
    }

    /// Changes only the planned date for an unfinished task.
    pub(crate) fn reschedule(
        &mut self,
        request: &RescheduleDraft,
        changed_at: i64,
    ) -> Result<bool, ScheduleValidationError> {
        validate_change_timestamp(changed_at, self.updated_at)?;
        if !matches!(self.status, TaskStatus::Todo | TaskStatus::InProgress) {
            return Err(ScheduleValidationError::Transition);
        }
        if self.planned_date == request.planned_date {
            return Ok(false);
        }
        self.planned_date = request.planned_date.clone();
        self.updated_at = changed_at;
        Ok(true)
    }

    /// Applies one allowed lifecycle transition without touching study records.
    pub(crate) fn transition(
        &mut self,
        transition: TaskTransition,
        changed_at: i64,
    ) -> Result<(), ScheduleValidationError> {
        validate_change_timestamp(changed_at, self.updated_at)?;
        match (self.status, transition) {
            (TaskStatus::Todo, TaskTransition::Start) => {
                self.status = TaskStatus::InProgress;
            }
            (TaskStatus::Todo | TaskStatus::InProgress, TaskTransition::Complete) => {
                self.status = TaskStatus::Done;
                self.completed_at = Some(changed_at);
            }
            (TaskStatus::Done, TaskTransition::Reopen) => {
                self.status = TaskStatus::Todo;
                self.completed_at = None;
            }
            (TaskStatus::Todo | TaskStatus::InProgress, TaskTransition::Cancel) => {
                self.status = TaskStatus::Canceled;
            }
            (TaskStatus::Canceled, TaskTransition::Restore) => {
                self.status = TaskStatus::Todo;
            }
            _ => return Err(ScheduleValidationError::Transition),
        }
        self.updated_at = changed_at;
        Ok(())
    }
}

fn normalize_subject_id(
    subject_id: Option<String>,
) -> Result<Option<String>, ScheduleValidationError> {
    normalize_optional_id(subject_id)
}

fn normalize_optional_id(
    identifier: Option<String>,
) -> Result<Option<String>, ScheduleValidationError> {
    identifier
        .map(|value| {
            Uuid::parse_str(&value)
                .map(|identifier| identifier.to_string())
                .map_err(|_| ScheduleValidationError::Identifier)
        })
        .transpose()
}

fn normalize_task_title(title: &str) -> Result<String, ScheduleValidationError> {
    let title = title.trim().to_owned();
    if title.is_empty() || title.chars().count() > 120 {
        Err(ScheduleValidationError::Text)
    } else {
        Ok(title)
    }
}

fn normalize_task_description(
    description: Option<&str>,
) -> Result<Option<String>, ScheduleValidationError> {
    let description = description.map(str::trim).filter(|value| !value.is_empty());
    if description
        .as_ref()
        .is_some_and(|value| value.chars().count() > 2_000)
    {
        Err(ScheduleValidationError::Text)
    } else {
        Ok(description.map(str::to_owned))
    }
}

fn validate_estimated_minutes(
    estimated_minutes: Option<u32>,
) -> Result<(), ScheduleValidationError> {
    if estimated_minutes.is_some_and(|minutes| !(1..=1_440).contains(&minutes)) {
        Err(ScheduleValidationError::EstimatedMinutes)
    } else {
        Ok(())
    }
}

fn validate_timestamp(value: i64) -> Result<(), ScheduleValidationError> {
    if value < 0 {
        Err(ScheduleValidationError::Timestamp)
    } else {
        Ok(())
    }
}

fn validate_change_timestamp(
    value: i64,
    current_updated_at: i64,
) -> Result<(), ScheduleValidationError> {
    validate_timestamp(value)?;
    if value < current_updated_at {
        Err(ScheduleValidationError::Timestamp)
    } else {
        Ok(())
    }
}

fn parse_digits(bytes: &[u8]) -> Option<u32> {
    bytes.iter().try_fold(0_u32, |value, byte| {
        byte.is_ascii_digit()
            .then(|| value * 10 + u32::from(*byte - b'0'))
    })
}

const fn days_in_month(year: u32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap_year(year) => 29,
        2 => 28,
        _ => 0,
    }
}

const fn is_leap_year(year: u32) -> bool {
    year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400))
}

#[cfg(test)]
mod tests {
    use super::{
        LocalDate, RescheduleDraft, ScheduleValidationError, Subject, SubjectColor, Task,
        TaskDetailsDraft, TaskPriority, TaskStatus, TaskTransition,
    };

    fn task(status: TaskStatus) -> Task {
        Task {
            id: "019f7328-4b66-7613-9729-e3570fc41525".to_owned(),
            subject_id: None,
            parent_task_id: None,
            title: "线性代数强化".to_owned(),
            description: None,
            planned_date: LocalDate::parse("2026-07-18").expect("fixture date should be valid"),
            estimated_minutes: Some(90),
            priority: TaskPriority::Normal,
            status,
            manual_order: 0,
            completed_at: None,
            created_at: 1_700_000_000_000,
            updated_at: 1_700_000_000_000,
        }
    }

    #[test]
    fn local_date_accepts_a_real_leap_day() {
        let date = LocalDate::parse("2024-02-29").expect("leap day should parse");

        assert_eq!(date.as_str(), "2024-02-29");
    }

    #[test]
    fn local_date_rejects_a_nonexistent_day() {
        let error = LocalDate::parse("2026-02-29").expect_err("invalid day must be rejected");

        assert_eq!(error, ScheduleValidationError::Date);
    }

    #[test]
    fn local_date_arithmetic_crosses_leap_day_and_year_boundary() {
        let start = LocalDate::parse("2024-02-28").expect("fixture date should parse");
        let result = start.add_days(308).expect("date should remain supported");

        assert_eq!(result.as_str(), "2025-01-01");
    }

    #[test]
    fn local_date_days_since_is_signed_and_calendar_based() {
        let earlier = LocalDate::parse("2024-02-28").expect("fixture date should parse");
        let later = LocalDate::parse("2024-03-01").expect("fixture date should parse");

        assert_eq!(later.days_since(&earlier), 2);
    }

    #[test]
    fn local_date_weekday_uses_monday_as_zero() {
        let monday = LocalDate::parse("2026-07-20").expect("date should parse");
        let sunday = LocalDate::parse("2026-07-26").expect("date should parse");

        assert_eq!(monday.weekday_from_monday(), 0);
        assert_eq!(sunday.weekday_from_monday(), 6);
    }

    #[test]
    fn local_date_subtraction_crosses_month_and_leap_day() {
        let march = LocalDate::parse("2024-03-01").expect("date should parse");

        let result = march.subtract_days(2).expect("date should remain valid");

        assert_eq!(result.as_str(), "2024-02-28");
    }

    #[test]
    fn task_complete_sets_status_and_timestamp() {
        let mut task = task(TaskStatus::Todo);

        task.transition(TaskTransition::Complete, 1_700_000_000_100)
            .expect("todo task should complete");

        assert_eq!(task.status, TaskStatus::Done);
        assert_eq!(task.completed_at, Some(1_700_000_000_100));
    }

    #[test]
    fn task_start_moves_a_todo_task_to_in_progress() {
        let mut task = task(TaskStatus::Todo);

        task.transition(TaskTransition::Start, 1_700_000_000_100)
            .expect("todo task should start");

        assert_eq!(task.status, TaskStatus::InProgress);
        assert_eq!(task.completed_at, None);
    }

    #[test]
    fn task_details_update_preserves_planned_date_and_status() {
        let mut task = task(TaskStatus::InProgress);
        let original_date = task.planned_date.clone();
        let details = TaskDetailsDraft::new(
            None,
            "  线性代数错题复盘  ",
            Some("  重点检查特征值  "),
            Some(45),
            TaskPriority::High,
        )
        .expect("details should be valid");

        let changed = task
            .update_details(details, 1_700_000_000_100)
            .expect("details should update");

        assert!(changed);
        assert_eq!(task.title, "线性代数错题复盘");
        assert_eq!(task.description.as_deref(), Some("重点检查特征值"));
        assert_eq!(task.planned_date, original_date);
        assert_eq!(task.status, TaskStatus::InProgress);
    }

    #[test]
    fn archiving_a_subject_is_idempotent() {
        let mut subject = Subject {
            id: "019f7328-4b66-7613-9729-e3570fc41525".to_owned(),
            name: "408".to_owned(),
            color: SubjectColor::Blue,
            sort_order: 0,
            archived_at: None,
            created_at: 1_700_000_000_000,
            updated_at: 1_700_000_000_000,
        };

        assert!(
            subject
                .archive(1_700_000_000_100)
                .expect("active subject should archive")
        );
        assert!(
            !subject
                .archive(1_700_000_000_200)
                .expect("archived subject retry should be safe")
        );
        assert_eq!(subject.archived_at, Some(1_700_000_000_100));
        assert_eq!(subject.updated_at, 1_700_000_000_100);
    }

    #[test]
    fn task_rejects_reopening_an_unfinished_task() {
        let mut task = task(TaskStatus::Todo);

        let error = task
            .transition(TaskTransition::Reopen, 1_700_000_000_100)
            .expect_err("unfinished task cannot reopen");

        assert_eq!(error, ScheduleValidationError::Transition);
    }

    #[test]
    fn task_cancel_moves_an_active_task_to_canceled() {
        let mut task = task(TaskStatus::InProgress);

        task.transition(TaskTransition::Cancel, 1_700_000_000_100)
            .expect("active task should cancel");

        assert_eq!(task.status, TaskStatus::Canceled);
    }

    #[test]
    fn task_restore_moves_a_canceled_task_to_todo() {
        let mut task = task(TaskStatus::Canceled);

        task.transition(TaskTransition::Restore, 1_700_000_000_100)
            .expect("canceled task should restore");

        assert_eq!(task.status, TaskStatus::Todo);
    }

    #[test]
    fn task_cancel_rejects_a_completed_task() {
        let mut task = task(TaskStatus::Done);
        task.completed_at = Some(1_700_000_000_000);

        let error = task
            .transition(TaskTransition::Cancel, 1_700_000_000_100)
            .expect_err("completed task cannot cancel directly");

        assert_eq!(error, ScheduleValidationError::Transition);
    }

    #[test]
    fn task_restore_rejects_an_active_task() {
        let mut task = task(TaskStatus::Todo);

        let error = task
            .transition(TaskTransition::Restore, 1_700_000_000_100)
            .expect_err("active task cannot restore");

        assert_eq!(error, ScheduleValidationError::Transition);
    }

    #[test]
    fn task_reschedule_changes_only_the_planned_date() {
        let mut task = task(TaskStatus::InProgress);
        let original_status = task.status;
        let request = RescheduleDraft::new(
            LocalDate::parse("2026-07-20").expect("fixture date should parse"),
            "需要先补齐图论基础",
        )
        .expect("reschedule should be valid");

        let changed = task
            .reschedule(&request, 1_700_000_000_100)
            .expect("unfinished task should reschedule");

        assert!(changed);
        assert_eq!(task.planned_date.as_str(), "2026-07-20");
        assert_eq!(task.status, original_status);
    }

    #[test]
    fn task_reschedule_rejects_a_completed_task() {
        let mut task = task(TaskStatus::Done);
        task.completed_at = Some(1_700_000_000_000);
        let request = RescheduleDraft::new(
            LocalDate::parse("2026-07-20").expect("fixture date should parse"),
            "重新安排",
        )
        .expect("reschedule should be valid");

        let error = task
            .reschedule(&request, 1_700_000_000_100)
            .expect_err("completed task must reopen before rescheduling");

        assert_eq!(error, ScheduleValidationError::Transition);
    }

    #[test]
    fn reschedule_requires_a_non_empty_reason() {
        let date = LocalDate::parse("2026-07-20").expect("fixture date should parse");

        let error = RescheduleDraft::new(date, "  ")
            .expect_err("an empty reschedule reason must be rejected");

        assert_eq!(error, ScheduleValidationError::Text);
    }
}
