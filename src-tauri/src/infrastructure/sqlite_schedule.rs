use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, Row, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::application::{ScheduleError, ScheduleRepository};
use crate::domain::{
    DateRange, LocalDate, NewSubject, NewTask, RescheduleDraft, Subject, SubjectColor, Task,
    TaskChange, TaskChangeSnapshot, TaskChangeType, TaskDetailsDraft, TaskPriority, TaskStatus,
    TaskTransition,
};

use super::sqlite_workspace::{SqliteWorkspaceRepository, database_error, migrate, open_database};

/// `SQLite` adapter for subjects, tasks, and immutable task history.
#[derive(Debug, Clone)]
pub(crate) struct SqliteScheduleRepository {
    database_path: PathBuf,
}

impl SqliteScheduleRepository {
    /// Creates an adapter for the single default workspace database.
    pub(crate) fn new(application_data_directory: &Path) -> Self {
        let workspace = SqliteWorkspaceRepository::new(application_data_directory);
        Self {
            database_path: workspace.database_path(),
        }
    }

    fn open_current(&self) -> Result<(Connection, String), ScheduleError> {
        if !self.database_path.is_file() {
            return Err(ScheduleError::WorkspaceNotInitialized);
        }
        let mut connection = open_database(&self.database_path, false)?;
        migrate(&mut connection)?;
        let workspace_id = load_workspace_id(&connection)?;
        Ok((connection, workspace_id))
    }
}

impl ScheduleRepository for SqliteScheduleRepository {
    fn create_subject(&self, subject: &NewSubject) -> Result<Subject, ScheduleError> {
        let (mut connection, workspace_id) = self.open_current()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(schedule_database_error)?;
        let duplicate = transaction
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM subject
                    WHERE workspace_id = ?1 AND name = ?2 COLLATE NOCASE AND archived_at IS NULL
                 )",
                params![workspace_id, subject.name],
                |row| row.get::<_, bool>(0),
            )
            .map_err(schedule_database_error)?;
        if duplicate {
            return Err(ScheduleError::SubjectNameConflict);
        }
        transaction
            .execute(
                "INSERT INTO subject(
                    id, workspace_id, name, color_key, sort_order,
                    archived_at, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?6)",
                params![
                    subject.id,
                    workspace_id,
                    subject.name,
                    subject.color.as_str(),
                    subject.sort_order,
                    subject.created_at
                ],
            )
            .map_err(schedule_database_error)?;
        transaction.commit().map_err(schedule_database_error)?;

        Ok(Subject {
            id: subject.id.clone(),
            name: subject.name.clone(),
            color: subject.color,
            sort_order: subject.sort_order,
            archived_at: None,
            created_at: subject.created_at,
            updated_at: subject.created_at,
        })
    }

    fn list_subjects(&self) -> Result<Vec<Subject>, ScheduleError> {
        let (connection, workspace_id) = self.open_current()?;
        let mut statement = connection
            .prepare(
                "SELECT id, name, color_key, sort_order, archived_at, created_at, updated_at
                 FROM subject
                 WHERE workspace_id = ?1
                 ORDER BY archived_at IS NOT NULL, sort_order, created_at, id",
            )
            .map_err(schedule_database_error)?;
        let rows = statement
            .query_map([workspace_id], raw_subject)
            .map_err(schedule_database_error)?;
        rows.map(|row| {
            row.map_err(schedule_database_error)
                .and_then(subject_from_raw)
        })
        .collect()
    }

    fn archive_subject(
        &self,
        subject_id: &str,
        archived_at: i64,
    ) -> Result<Subject, ScheduleError> {
        let (mut connection, workspace_id) = self.open_current()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(schedule_database_error)?;
        let raw = transaction
            .query_row(
                "SELECT id, name, color_key, sort_order, archived_at, created_at, updated_at
                 FROM subject
                 WHERE id = ?1 AND workspace_id = ?2",
                params![subject_id, workspace_id],
                raw_subject,
            )
            .optional()
            .map_err(schedule_database_error)?
            .ok_or(ScheduleError::SubjectNotFound)?;
        let mut subject = subject_from_raw(raw)?;
        if subject.archive(archived_at)? {
            transaction
                .execute(
                    "UPDATE subject
                     SET archived_at = ?1, updated_at = ?1
                     WHERE id = ?2 AND workspace_id = ?3",
                    params![archived_at, subject.id, workspace_id],
                )
                .map_err(schedule_database_error)?;
        }
        transaction.commit().map_err(schedule_database_error)?;
        Ok(subject)
    }

    fn create_task(&self, task: &NewTask) -> Result<Task, ScheduleError> {
        let (mut connection, workspace_id) = self.open_current()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(schedule_database_error)?;
        validate_subject(
            &transaction,
            &workspace_id,
            task.draft.subject_id.as_deref(),
        )?;
        let created = task_from_new(task);
        transaction
            .execute(
                "INSERT INTO task(
                    id, workspace_id, subject_id, parent_task_id, title, description,
                    planned_date, estimated_minutes, priority, status, manual_order,
                    source_type, completed_at, deleted_at, created_at, updated_at
                 ) VALUES (
                    ?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7, ?8, 'todo', ?9,
                    'manual', NULL, NULL, ?10, ?10
                 )",
                params![
                    created.id,
                    workspace_id,
                    created.subject_id,
                    created.title,
                    created.description,
                    created.planned_date.as_str(),
                    created.estimated_minutes,
                    created.priority.as_str(),
                    created.manual_order,
                    created.created_at
                ],
            )
            .map_err(schedule_database_error)?;
        append_change(
            &transaction,
            &created,
            None,
            TaskChangeType::Created,
            None,
            created.created_at,
        )?;
        transaction.commit().map_err(schedule_database_error)?;
        Ok(created)
    }

    fn list_tasks(&self, range: &DateRange) -> Result<Vec<Task>, ScheduleError> {
        let (connection, workspace_id) = self.open_current()?;
        let mut statement = connection
            .prepare(
                "SELECT id, subject_id, parent_task_id, title, description, planned_date,
                        estimated_minutes, priority, status, manual_order, completed_at,
                        created_at, updated_at
                 FROM task
                 WHERE workspace_id = ?1
                   AND planned_date BETWEEN ?2 AND ?3
                   AND deleted_at IS NULL
                 ORDER BY
                    CASE status
                        WHEN 'in_progress' THEN 0
                        WHEN 'todo' THEN 1
                        WHEN 'done' THEN 2
                        ELSE 3
                    END,
                    CASE priority
                        WHEN 'high' THEN 0
                        WHEN 'normal' THEN 1
                        ELSE 2
                    END,
                    manual_order, created_at, id",
            )
            .map_err(schedule_database_error)?;
        let rows = statement
            .query_map(
                params![workspace_id, range.start.as_str(), range.end.as_str()],
                raw_task,
            )
            .map_err(schedule_database_error)?;
        rows.map(|row| row.map_err(schedule_database_error).and_then(task_from_raw))
            .collect()
    }

    fn update_task_details(
        &self,
        task_id: &str,
        details: TaskDetailsDraft,
        changed_at: i64,
    ) -> Result<Task, ScheduleError> {
        let (mut connection, workspace_id) = self.open_current()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(schedule_database_error)?;
        let mut task = load_task(&transaction, &workspace_id, task_id)?;
        if details.subject_id != task.subject_id {
            validate_subject(&transaction, &workspace_id, details.subject_id.as_deref())?;
        }
        let before = task.clone();
        if task.update_details(details, changed_at)? {
            transaction
                .execute(
                    "UPDATE task
                     SET subject_id = ?1, title = ?2, description = ?3,
                         estimated_minutes = ?4, priority = ?5, updated_at = ?6
                     WHERE id = ?7 AND workspace_id = ?8",
                    params![
                        task.subject_id,
                        task.title,
                        task.description,
                        task.estimated_minutes,
                        task.priority.as_str(),
                        task.updated_at,
                        task.id,
                        workspace_id
                    ],
                )
                .map_err(schedule_database_error)?;
            append_change(
                &transaction,
                &task,
                Some(&before),
                TaskChangeType::Edited,
                None,
                changed_at,
            )?;
        }
        transaction.commit().map_err(schedule_database_error)?;
        Ok(task)
    }

    fn reschedule_task(
        &self,
        task_id: &str,
        request: &RescheduleDraft,
        changed_at: i64,
    ) -> Result<Task, ScheduleError> {
        let (mut connection, workspace_id) = self.open_current()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(schedule_database_error)?;
        let mut task = load_task(&transaction, &workspace_id, task_id)?;
        let before = task.clone();
        if task.reschedule(request, changed_at)? {
            transaction
                .execute(
                    "UPDATE task
                     SET planned_date = ?1, updated_at = ?2
                     WHERE id = ?3 AND workspace_id = ?4",
                    params![
                        task.planned_date.as_str(),
                        task.updated_at,
                        task.id,
                        workspace_id
                    ],
                )
                .map_err(schedule_database_error)?;
            append_change(
                &transaction,
                &task,
                Some(&before),
                TaskChangeType::Rescheduled,
                Some(&request.reason),
                changed_at,
            )?;
        }
        transaction.commit().map_err(schedule_database_error)?;
        Ok(task)
    }

    fn transition_task(
        &self,
        task_id: &str,
        transition: TaskTransition,
        changed_at: i64,
    ) -> Result<Task, ScheduleError> {
        let (mut connection, workspace_id) = self.open_current()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(schedule_database_error)?;
        let mut task = load_task(&transaction, &workspace_id, task_id)?;
        let before = task.clone();
        task.transition(transition, changed_at)?;
        transaction
            .execute(
                "UPDATE task
                 SET status = ?1, completed_at = ?2, updated_at = ?3
                 WHERE id = ?4 AND workspace_id = ?5",
                params![
                    task.status.as_str(),
                    task.completed_at,
                    task.updated_at,
                    task.id,
                    workspace_id
                ],
            )
            .map_err(schedule_database_error)?;
        let change_type = match transition {
            TaskTransition::Start => TaskChangeType::Started,
            TaskTransition::Complete => TaskChangeType::Completed,
            TaskTransition::Reopen => TaskChangeType::Reopened,
            TaskTransition::Cancel => TaskChangeType::Canceled,
            TaskTransition::Restore => TaskChangeType::Restored,
        };
        append_change(
            &transaction,
            &task,
            Some(&before),
            change_type,
            None,
            changed_at,
        )?;
        transaction.commit().map_err(schedule_database_error)?;
        Ok(task)
    }

    fn list_task_changes(&self, task_id: &str) -> Result<Vec<TaskChange>, ScheduleError> {
        let (connection, workspace_id) = self.open_current()?;
        load_task(&connection, &workspace_id, task_id)?;
        let mut statement = connection
            .prepare(
                "SELECT id, task_id, change_type, before_json, after_json, reason, created_at
                 FROM task_change
                 WHERE task_id = ?1
                 ORDER BY created_at DESC, id DESC",
            )
            .map_err(schedule_database_error)?;
        let rows = statement
            .query_map([task_id], raw_task_change)
            .map_err(schedule_database_error)?;
        rows.map(|row| {
            row.map_err(schedule_database_error)
                .and_then(task_change_from_raw)
        })
        .collect()
    }
}

#[derive(Debug)]
struct RawSubject {
    id: String,
    name: String,
    color_key: String,
    sort_order: i64,
    archived_at: Option<i64>,
    created_at: i64,
    updated_at: i64,
}

fn raw_subject(row: &Row<'_>) -> rusqlite::Result<RawSubject> {
    Ok(RawSubject {
        id: row.get(0)?,
        name: row.get(1)?,
        color_key: row.get(2)?,
        sort_order: row.get(3)?,
        archived_at: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn subject_from_raw(raw: RawSubject) -> Result<Subject, ScheduleError> {
    let color = SubjectColor::parse(&raw.color_key).ok_or(ScheduleError::InvalidStoredData)?;
    Ok(Subject {
        id: raw.id,
        name: raw.name,
        color,
        sort_order: u32::try_from(raw.sort_order).map_err(|_| ScheduleError::InvalidStoredData)?,
        archived_at: raw.archived_at,
        created_at: raw.created_at,
        updated_at: raw.updated_at,
    })
}

#[derive(Debug)]
struct RawTask {
    id: String,
    subject_id: Option<String>,
    parent_task_id: Option<String>,
    title: String,
    description: Option<String>,
    planned_date: String,
    estimated_minutes: Option<i64>,
    priority: String,
    status: String,
    manual_order: i64,
    completed_at: Option<i64>,
    created_at: i64,
    updated_at: i64,
}

fn raw_task(row: &Row<'_>) -> rusqlite::Result<RawTask> {
    Ok(RawTask {
        id: row.get(0)?,
        subject_id: row.get(1)?,
        parent_task_id: row.get(2)?,
        title: row.get(3)?,
        description: row.get(4)?,
        planned_date: row.get(5)?,
        estimated_minutes: row.get(6)?,
        priority: row.get(7)?,
        status: row.get(8)?,
        manual_order: row.get(9)?,
        completed_at: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

fn task_from_raw(raw: RawTask) -> Result<Task, ScheduleError> {
    let estimated_minutes = raw
        .estimated_minutes
        .map(u32::try_from)
        .transpose()
        .map_err(|_| ScheduleError::InvalidStoredData)?;
    let priority = TaskPriority::parse(&raw.priority).ok_or(ScheduleError::InvalidStoredData)?;
    let status = TaskStatus::parse(&raw.status).ok_or(ScheduleError::InvalidStoredData)?;
    let completed_is_valid = matches!(status, TaskStatus::Done) == raw.completed_at.is_some();
    if !completed_is_valid || raw.created_at < 0 || raw.updated_at < raw.created_at {
        return Err(ScheduleError::InvalidStoredData);
    }
    Ok(Task {
        id: raw.id,
        subject_id: raw.subject_id,
        parent_task_id: raw.parent_task_id,
        title: raw.title,
        description: raw.description,
        planned_date: LocalDate::parse(&raw.planned_date)
            .map_err(|_| ScheduleError::InvalidStoredData)?,
        estimated_minutes,
        priority,
        status,
        manual_order: u32::try_from(raw.manual_order)
            .map_err(|_| ScheduleError::InvalidStoredData)?,
        completed_at: raw.completed_at,
        created_at: raw.created_at,
        updated_at: raw.updated_at,
    })
}

fn task_from_new(task: &NewTask) -> Task {
    Task {
        id: task.id.clone(),
        subject_id: task.draft.subject_id.clone(),
        parent_task_id: None,
        title: task.draft.title.clone(),
        description: task.draft.description.clone(),
        planned_date: task.draft.planned_date.clone(),
        estimated_minutes: task.draft.estimated_minutes,
        priority: task.draft.priority,
        status: TaskStatus::Todo,
        manual_order: task.draft.manual_order,
        completed_at: None,
        created_at: task.created_at,
        updated_at: task.created_at,
    }
}

fn load_task(
    connection: &Connection,
    workspace_id: &str,
    task_id: &str,
) -> Result<Task, ScheduleError> {
    let raw = connection
        .query_row(
            "SELECT id, subject_id, parent_task_id, title, description, planned_date,
                    estimated_minutes, priority, status, manual_order, completed_at,
                    created_at, updated_at
             FROM task
             WHERE id = ?1 AND workspace_id = ?2 AND deleted_at IS NULL",
            params![task_id, workspace_id],
            raw_task,
        )
        .optional()
        .map_err(schedule_database_error)?
        .ok_or(ScheduleError::TaskNotFound)?;
    task_from_raw(raw)
}

fn load_workspace_id(connection: &Connection) -> Result<String, ScheduleError> {
    connection
        .query_row(
            "SELECT id FROM workspace WHERE singleton_key = 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(schedule_database_error)?
        .ok_or(ScheduleError::WorkspaceNotInitialized)
}

fn validate_subject(
    connection: &Connection,
    workspace_id: &str,
    subject_id: Option<&str>,
) -> Result<(), ScheduleError> {
    let Some(subject_id) = subject_id else {
        return Ok(());
    };
    let exists = connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM subject
                WHERE id = ?1 AND workspace_id = ?2 AND archived_at IS NULL
             )",
            params![subject_id, workspace_id],
            |row| row.get::<_, bool>(0),
        )
        .map_err(schedule_database_error)?;
    if exists {
        Ok(())
    } else {
        Err(ScheduleError::SubjectNotFound)
    }
}

#[derive(Debug)]
struct RawTaskChange {
    id: String,
    task_id: String,
    change_type: String,
    before_json: Option<String>,
    after_json: Option<String>,
    reason: Option<String>,
    created_at: i64,
}

fn raw_task_change(row: &Row<'_>) -> rusqlite::Result<RawTaskChange> {
    Ok(RawTaskChange {
        id: row.get(0)?,
        task_id: row.get(1)?,
        change_type: row.get(2)?,
        before_json: row.get(3)?,
        after_json: row.get(4)?,
        reason: row.get(5)?,
        created_at: row.get(6)?,
    })
}

fn task_change_from_raw(raw: RawTaskChange) -> Result<TaskChange, ScheduleError> {
    if Uuid::parse_str(&raw.id).is_err()
        || Uuid::parse_str(&raw.task_id).is_err()
        || raw.created_at < 0
    {
        return Err(ScheduleError::InvalidStoredData);
    }
    let change_type =
        TaskChangeType::parse(&raw.change_type).ok_or(ScheduleError::InvalidStoredData)?;
    let before = parse_stored_snapshot(raw.before_json.as_deref())?;
    let after = parse_stored_snapshot(raw.after_json.as_deref())?;
    if before.is_none() && after.is_none() {
        return Err(ScheduleError::InvalidStoredData);
    }
    let reason = raw
        .reason
        .map(|value| {
            let normalized = value.trim();
            if normalized.is_empty() || normalized.chars().count() > 500 || normalized != value {
                Err(ScheduleError::InvalidStoredData)
            } else {
                Ok(value)
            }
        })
        .transpose()?;
    if matches!(change_type, TaskChangeType::Rescheduled) && reason.is_none() {
        return Err(ScheduleError::InvalidStoredData);
    }
    Ok(TaskChange {
        id: raw.id,
        task_id: raw.task_id,
        change_type,
        before,
        after,
        reason,
        created_at: raw.created_at,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredTaskSnapshot {
    subject_id: Option<String>,
    title: String,
    description: Option<String>,
    planned_date: String,
    estimated_minutes: Option<u32>,
    priority: String,
    status: String,
    manual_order: u32,
    completed_at: Option<i64>,
}

fn parse_stored_snapshot(value: Option<&str>) -> Result<Option<TaskChangeSnapshot>, ScheduleError> {
    value
        .map(|json| {
            let raw: StoredTaskSnapshot =
                serde_json::from_str(json).map_err(|_| ScheduleError::InvalidStoredData)?;
            task_change_snapshot_from_stored(raw)
        })
        .transpose()
}

fn task_change_snapshot_from_stored(
    raw: StoredTaskSnapshot,
) -> Result<TaskChangeSnapshot, ScheduleError> {
    let StoredTaskSnapshot {
        subject_id,
        title,
        description,
        planned_date,
        estimated_minutes,
        priority,
        status,
        manual_order,
        completed_at,
    } = raw;
    let details = TaskDetailsDraft::new(
        subject_id.clone(),
        &title,
        description.as_deref(),
        estimated_minutes,
        TaskPriority::parse(&priority).ok_or(ScheduleError::InvalidStoredData)?,
    )
    .map_err(|_| ScheduleError::InvalidStoredData)?;
    if details.subject_id != subject_id
        || details.title != title
        || details.description != description
    {
        return Err(ScheduleError::InvalidStoredData);
    }
    let status = TaskStatus::parse(&status).ok_or(ScheduleError::InvalidStoredData)?;
    if matches!(status, TaskStatus::Done) != completed_at.is_some()
        || completed_at.is_some_and(|timestamp| timestamp < 0)
    {
        return Err(ScheduleError::InvalidStoredData);
    }
    Ok(TaskChangeSnapshot {
        subject_id: details.subject_id,
        title: details.title,
        description: details.description,
        planned_date: LocalDate::parse(&planned_date)
            .map_err(|_| ScheduleError::InvalidStoredData)?,
        estimated_minutes: details.estimated_minutes,
        priority: details.priority,
        status,
        manual_order,
        completed_at,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskSnapshot<'a> {
    subject_id: Option<&'a str>,
    title: &'a str,
    description: Option<&'a str>,
    planned_date: &'a str,
    estimated_minutes: Option<u32>,
    priority: &'static str,
    status: &'static str,
    manual_order: u32,
    completed_at: Option<i64>,
}

impl<'a> From<&'a Task> for TaskSnapshot<'a> {
    fn from(task: &'a Task) -> Self {
        Self {
            subject_id: task.subject_id.as_deref(),
            title: &task.title,
            description: task.description.as_deref(),
            planned_date: task.planned_date.as_str(),
            estimated_minutes: task.estimated_minutes,
            priority: task.priority.as_str(),
            status: task.status.as_str(),
            manual_order: task.manual_order,
            completed_at: task.completed_at,
        }
    }
}

fn append_change(
    connection: &Connection,
    after: &Task,
    before: Option<&Task>,
    change_type: TaskChangeType,
    reason: Option<&str>,
    created_at: i64,
) -> Result<(), ScheduleError> {
    let before_json = before
        .map(TaskSnapshot::from)
        .map(|snapshot| serde_json::to_string(&snapshot))
        .transpose()
        .map_err(|_| ScheduleError::InvalidStoredData)?;
    let after_json = serde_json::to_string(&TaskSnapshot::from(after))
        .map_err(|_| ScheduleError::InvalidStoredData)?;
    connection
        .execute(
            "INSERT INTO task_change(
                id, task_id, change_type, before_json, after_json, reason, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                Uuid::now_v7().to_string(),
                after.id,
                change_type.as_str(),
                before_json,
                after_json,
                reason,
                created_at
            ],
        )
        .map_err(schedule_database_error)?;
    Ok(())
}

fn schedule_database_error(source: rusqlite::Error) -> ScheduleError {
    ScheduleError::Persistence(database_error(source))
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;
    use tempfile::{TempDir, tempdir};

    use super::SqliteScheduleRepository;
    use crate::application::{ScheduleError, ScheduleRepository, WorkspaceRepository};
    use crate::domain::{
        DateRange, LocalDate, NewSubject, NewTask, NewWorkspace, RescheduleDraft, SubjectColor,
        TaskChangeType, TaskDetailsDraft, TaskDraft, TaskPriority, TaskStatus, TaskTransition,
    };
    use crate::infrastructure::SqliteWorkspaceRepository;

    struct Fixture {
        _application_data: TempDir,
        workspace: SqliteWorkspaceRepository,
        schedule: SqliteScheduleRepository,
    }

    fn initialized_fixture() -> Fixture {
        let application_data = tempdir().expect("temporary application data should exist");
        let workspace = SqliteWorkspaceRepository::new(application_data.path());
        workspace
            .initialize_default(&NewWorkspace::default_at(1_700_000_000_000))
            .expect("workspace should initialize");
        Fixture {
            schedule: SqliteScheduleRepository::new(application_data.path()),
            _application_data: application_data,
            workspace,
        }
    }

    fn new_task(title: &str, priority: TaskPriority, created_at: i64) -> NewTask {
        new_task_for_subject(title, None, priority, created_at)
    }

    fn new_task_for_subject(
        title: &str,
        subject_id: Option<String>,
        priority: TaskPriority,
        created_at: i64,
    ) -> NewTask {
        NewTask::manual(
            TaskDraft::new(
                subject_id,
                title,
                None,
                LocalDate::parse("2026-07-18").expect("fixture date should parse"),
                Some(60),
                priority,
                0,
            )
            .expect("fixture draft should be valid"),
            created_at,
        )
        .expect("fixture task should be valid")
    }

    fn one_day_range() -> DateRange {
        let date = LocalDate::parse("2026-07-18").expect("fixture date should parse");
        DateRange::new(date.clone(), date).expect("fixture range should be valid")
    }

    #[test]
    fn create_subject_persists_in_stable_order() {
        let fixture = initialized_fixture();
        let subject = NewSubject::new("408", SubjectColor::Blue, 2, 1_700_000_000_001)
            .expect("subject should be valid");

        fixture
            .schedule
            .create_subject(&subject)
            .expect("subject should persist");
        let subjects = fixture
            .schedule
            .list_subjects()
            .expect("subjects should list");

        assert_eq!(subjects.len(), 1);
        assert_eq!(subjects[0].name, "408");
    }

    #[test]
    fn create_subject_rejects_a_duplicate_active_name() {
        let fixture = initialized_fixture();
        let first = NewSubject::new("English", SubjectColor::Blue, 0, 1_700_000_000_001)
            .expect("subject should be valid");
        let second = NewSubject::new("english", SubjectColor::Green, 1, 1_700_000_000_002)
            .expect("subject should be valid");
        fixture
            .schedule
            .create_subject(&first)
            .expect("first subject should persist");

        let error = fixture
            .schedule
            .create_subject(&second)
            .expect_err("duplicate active subject must fail");

        assert!(matches!(error, ScheduleError::SubjectNameConflict));
    }

    #[test]
    fn create_task_inserts_created_history_in_the_same_transaction() {
        let fixture = initialized_fixture();
        let task = new_task("线性代数强化", TaskPriority::Normal, 1_700_000_000_001);

        let created = fixture
            .schedule
            .create_task(&task)
            .expect("task should persist");
        let connection =
            Connection::open(fixture.workspace.database_path()).expect("database should reopen");
        let change_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM task_change WHERE task_id = ?1 AND change_type = 'created'",
                [created.id],
                |row| row.get(0),
            )
            .expect("history should be readable");

        assert_eq!(change_count, 1);
    }

    #[test]
    fn list_tasks_orders_high_priority_before_normal_priority() {
        let fixture = initialized_fixture();
        fixture
            .schedule
            .create_task(&new_task(
                "普通任务",
                TaskPriority::Normal,
                1_700_000_000_001,
            ))
            .expect("normal task should persist");
        fixture
            .schedule
            .create_task(&new_task(
                "高优先任务",
                TaskPriority::High,
                1_700_000_000_002,
            ))
            .expect("high task should persist");

        let tasks = fixture
            .schedule
            .list_tasks(&one_day_range())
            .expect("tasks should list");

        assert_eq!(tasks[0].title, "高优先任务");
    }

    #[test]
    fn transition_task_completes_and_appends_history() {
        let fixture = initialized_fixture();
        let created = fixture
            .schedule
            .create_task(&new_task(
                "完成测试",
                TaskPriority::Normal,
                1_700_000_000_001,
            ))
            .expect("task should persist");

        let completed = fixture
            .schedule
            .transition_task(&created.id, TaskTransition::Complete, 1_700_000_000_002)
            .expect("task should complete");
        let connection =
            Connection::open(fixture.workspace.database_path()).expect("database should reopen");
        let change_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM task_change WHERE task_id = ?1",
                [created.id],
                |row| row.get(0),
            )
            .expect("history should be readable");

        assert_eq!(completed.status, TaskStatus::Done);
        assert_eq!(change_count, 2);
    }

    #[test]
    fn transition_task_starts_and_appends_started_history() {
        let fixture = initialized_fixture();
        let created = fixture
            .schedule
            .create_task(&new_task(
                "开始测试",
                TaskPriority::Normal,
                1_700_000_000_001,
            ))
            .expect("task should persist");

        let started = fixture
            .schedule
            .transition_task(&created.id, TaskTransition::Start, 1_700_000_000_002)
            .expect("task should start");
        let connection =
            Connection::open(fixture.workspace.database_path()).expect("database should reopen");
        let started_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM task_change
                 WHERE task_id = ?1 AND change_type = 'started'",
                [created.id],
                |row| row.get(0),
            )
            .expect("history should be readable");

        assert_eq!(started.status, TaskStatus::InProgress);
        assert_eq!(started_count, 1);
    }

    #[test]
    fn update_task_details_is_atomic_and_preserves_planned_date() {
        let fixture = initialized_fixture();
        let created = fixture
            .schedule
            .create_task(&new_task("原任务", TaskPriority::Normal, 1_700_000_000_001))
            .expect("task should persist");
        let details = TaskDetailsDraft::new(
            None,
            "更新后的任务",
            Some("复盘说明"),
            Some(90),
            TaskPriority::High,
        )
        .expect("details should be valid");

        let updated = fixture
            .schedule
            .update_task_details(&created.id, details, 1_700_000_000_002)
            .expect("details should update");
        let connection =
            Connection::open(fixture.workspace.database_path()).expect("database should reopen");
        let (before_json, after_json): (String, String) = connection
            .query_row(
                "SELECT before_json, after_json FROM task_change
                 WHERE task_id = ?1 AND change_type = 'edited'",
                [created.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("edited history should be readable");
        let before: serde_json::Value =
            serde_json::from_str(&before_json).expect("before snapshot should parse");
        let after: serde_json::Value =
            serde_json::from_str(&after_json).expect("after snapshot should parse");

        assert_eq!(updated.title, "更新后的任务");
        assert_eq!(updated.planned_date, created.planned_date);
        assert_eq!(before["plannedDate"], after["plannedDate"]);
    }

    #[test]
    fn archiving_a_subject_keeps_assigned_tasks_and_blocks_new_assignment() {
        let fixture = initialized_fixture();
        let subject = NewSubject::new("408", SubjectColor::Blue, 0, 1_700_000_000_001)
            .expect("subject should be valid");
        let created_subject = fixture
            .schedule
            .create_subject(&subject)
            .expect("subject should persist");
        let assigned = fixture
            .schedule
            .create_task(&new_task_for_subject(
                "数据结构",
                Some(created_subject.id.clone()),
                TaskPriority::Normal,
                1_700_000_000_002,
            ))
            .expect("assigned task should persist");

        let archived = fixture
            .schedule
            .archive_subject(&created_subject.id, 1_700_000_000_003)
            .expect("subject should archive");
        let tasks = fixture
            .schedule
            .list_tasks(&one_day_range())
            .expect("tasks should still list");
        let subjects = fixture
            .schedule
            .list_subjects()
            .expect("archived subject should still list");
        let rejected = fixture.schedule.create_task(&new_task_for_subject(
            "新任务",
            Some(created_subject.id.clone()),
            TaskPriority::Normal,
            1_700_000_000_004,
        ));
        let preserved_details = TaskDetailsDraft::new(
            Some(created_subject.id.clone()),
            "数据结构复盘",
            None,
            Some(45),
            TaskPriority::High,
        )
        .expect("details should be valid");
        let preserved = fixture
            .schedule
            .update_task_details(&assigned.id, preserved_details, 1_700_000_000_005)
            .expect("an existing archived assignment should be preservable");

        assert_eq!(archived.archived_at, Some(1_700_000_000_003));
        assert_eq!(
            tasks[0].subject_id.as_deref(),
            Some(created_subject.id.as_str())
        );
        assert_eq!(subjects.len(), 1);
        assert!(subjects[0].archived_at.is_some());
        assert!(matches!(rejected, Err(ScheduleError::SubjectNotFound)));
        assert_eq!(preserved.subject_id, Some(created_subject.id));
    }

    #[test]
    fn reschedule_task_updates_date_reason_and_typed_history_atomically() {
        let fixture = initialized_fixture();
        let created = fixture
            .schedule
            .create_task(&new_task(
                "延期测试",
                TaskPriority::Normal,
                1_700_000_000_001,
            ))
            .expect("task should persist");
        let request = RescheduleDraft::new(
            LocalDate::parse("2026-07-20").expect("fixture date should parse"),
            "先完成前置章节",
        )
        .expect("reschedule should be valid");

        let updated = fixture
            .schedule
            .reschedule_task(&created.id, &request, 1_700_000_000_002)
            .expect("task should reschedule");
        let changes = fixture
            .schedule
            .list_task_changes(&created.id)
            .expect("history should list");
        let rescheduled = &changes[0];

        assert_eq!(updated.planned_date.as_str(), "2026-07-20");
        assert_eq!(rescheduled.change_type, TaskChangeType::Rescheduled);
        assert_eq!(rescheduled.reason.as_deref(), Some("先完成前置章节"));
        assert_eq!(
            rescheduled
                .before
                .as_ref()
                .expect("before snapshot should exist")
                .planned_date
                .as_str(),
            "2026-07-18"
        );
        assert_eq!(
            rescheduled
                .after
                .as_ref()
                .expect("after snapshot should exist")
                .planned_date
                .as_str(),
            "2026-07-20"
        );
    }

    #[test]
    fn reschedule_task_same_date_does_not_append_history() {
        let fixture = initialized_fixture();
        let created = fixture
            .schedule
            .create_task(&new_task(
                "不变日期",
                TaskPriority::Normal,
                1_700_000_000_001,
            ))
            .expect("task should persist");
        let request = RescheduleDraft::new(
            LocalDate::parse("2026-07-18").expect("fixture date should parse"),
            "日期未变化",
        )
        .expect("reschedule should be valid");

        fixture
            .schedule
            .reschedule_task(&created.id, &request, 1_700_000_000_002)
            .expect("same date should be a safe no-op");
        let changes = fixture
            .schedule
            .list_task_changes(&created.id)
            .expect("history should list");

        assert_eq!(changes.len(), 1);
    }

    #[test]
    fn reschedule_task_rejects_completed_task_without_history() {
        let fixture = initialized_fixture();
        let created = fixture
            .schedule
            .create_task(&new_task(
                "已完成任务",
                TaskPriority::Normal,
                1_700_000_000_001,
            ))
            .expect("task should persist");
        fixture
            .schedule
            .transition_task(&created.id, TaskTransition::Complete, 1_700_000_000_002)
            .expect("task should complete");
        let request = RescheduleDraft::new(
            LocalDate::parse("2026-07-20").expect("fixture date should parse"),
            "不应成功",
        )
        .expect("reschedule should be valid");

        let error = fixture
            .schedule
            .reschedule_task(&created.id, &request, 1_700_000_000_003)
            .expect_err("completed task must reopen first");
        let changes = fixture
            .schedule
            .list_task_changes(&created.id)
            .expect("history should list");

        assert!(matches!(
            error,
            ScheduleError::Validation(crate::domain::ScheduleValidationError::Transition)
        ));
        assert_eq!(changes.len(), 2);
    }

    #[test]
    fn cancel_and_restore_append_history_in_newest_first_order() {
        let fixture = initialized_fixture();
        let created = fixture
            .schedule
            .create_task(&new_task(
                "取消恢复测试",
                TaskPriority::Normal,
                1_700_000_000_001,
            ))
            .expect("task should persist");
        fixture
            .schedule
            .transition_task(&created.id, TaskTransition::Cancel, 1_700_000_000_002)
            .expect("task should cancel");
        let restored = fixture
            .schedule
            .transition_task(&created.id, TaskTransition::Restore, 1_700_000_000_003)
            .expect("task should restore");

        let changes = fixture
            .schedule
            .list_task_changes(&created.id)
            .expect("history should list");

        assert_eq!(restored.status, TaskStatus::Todo);
        assert_eq!(changes[0].change_type, TaskChangeType::Restored);
        assert_eq!(changes[1].change_type, TaskChangeType::Canceled);
        assert_eq!(changes[2].change_type, TaskChangeType::Created);
    }
}
