use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, Row, TransactionBehavior, params};
use serde::Serialize;
use uuid::Uuid;

use crate::application::{ScheduleError, ScheduleRepository};
use crate::domain::{
    DateRange, LocalDate, NewSubject, NewTask, Subject, SubjectColor, Task, TaskPriority,
    TaskStatus, TaskTransition,
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
                 WHERE workspace_id = ?1 AND archived_at IS NULL
                 ORDER BY sort_order, created_at, id",
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
        append_change(&transaction, &created, None, "created", created.created_at)?;
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
        let raw = transaction
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
        let mut task = task_from_raw(raw)?;
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
            TaskTransition::Complete => "completed",
            TaskTransition::Reopen => "reopened",
        };
        append_change(&transaction, &task, Some(&before), change_type, changed_at)?;
        transaction.commit().map_err(schedule_database_error)?;
        Ok(task)
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
    change_type: &str,
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
             ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)",
            params![
                Uuid::now_v7().to_string(),
                after.id,
                change_type,
                before_json,
                after_json,
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
        DateRange, LocalDate, NewSubject, NewTask, NewWorkspace, SubjectColor, TaskDraft,
        TaskPriority, TaskStatus, TaskTransition,
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
        NewTask::manual(
            TaskDraft::new(
                None,
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
}
