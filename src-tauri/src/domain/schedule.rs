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
    /// A timestamp cannot represent a persisted event.
    #[error("schedule timestamp is invalid")]
    Timestamp,
    /// A referenced local identifier is malformed.
    #[error("schedule identifier is invalid")]
    Identifier,
    /// A task transition is not valid from the current state.
    #[error("task transition is invalid")]
    Transition,
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
    Complete,
    Reopen,
}

impl TaskTransition {
    /// Parses one transition token accepted by the command boundary.
    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "complete" => Some(Self::Complete),
            "reopen" => Some(Self::Reopen),
            _ => None,
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
        if subject_id
            .as_deref()
            .is_some_and(|value| Uuid::parse_str(value).is_err())
        {
            return Err(ScheduleValidationError::Identifier);
        }
        let title = title.trim().to_owned();
        if title.is_empty() || title.chars().count() > 120 {
            return Err(ScheduleValidationError::Text);
        }
        let description = description.map(str::trim).filter(|value| !value.is_empty());
        if description
            .as_ref()
            .is_some_and(|value| value.chars().count() > 2_000)
        {
            return Err(ScheduleValidationError::Text);
        }
        if estimated_minutes.is_some_and(|minutes| !(1..=1_440).contains(&minutes)) {
            return Err(ScheduleValidationError::EstimatedMinutes);
        }
        Ok(Self {
            subject_id,
            title,
            description: description.map(str::to_owned),
            planned_date,
            estimated_minutes,
            priority,
            manual_order,
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

impl Task {
    /// Applies one allowed lifecycle transition without touching study records.
    pub(crate) fn transition(
        &mut self,
        transition: TaskTransition,
        changed_at: i64,
    ) -> Result<(), ScheduleValidationError> {
        validate_timestamp(changed_at)?;
        match (self.status, transition) {
            (TaskStatus::Todo | TaskStatus::InProgress, TaskTransition::Complete) => {
                self.status = TaskStatus::Done;
                self.completed_at = Some(changed_at);
            }
            (TaskStatus::Done, TaskTransition::Reopen) => {
                self.status = TaskStatus::Todo;
                self.completed_at = None;
            }
            _ => return Err(ScheduleValidationError::Transition),
        }
        self.updated_at = changed_at;
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
        LocalDate, ScheduleValidationError, Task, TaskPriority, TaskStatus, TaskTransition,
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
    fn task_complete_sets_status_and_timestamp() {
        let mut task = task(TaskStatus::Todo);

        task.transition(TaskTransition::Complete, 1_700_000_000_100)
            .expect("todo task should complete");

        assert_eq!(task.status, TaskStatus::Done);
        assert_eq!(task.completed_at, Some(1_700_000_000_100));
    }

    #[test]
    fn task_rejects_reopening_an_unfinished_task() {
        let mut task = task(TaskStatus::Todo);

        let error = task
            .transition(TaskTransition::Reopen, 1_700_000_000_100)
            .expect_err("unfinished task cannot reopen");

        assert_eq!(error, ScheduleValidationError::Transition);
    }
}
