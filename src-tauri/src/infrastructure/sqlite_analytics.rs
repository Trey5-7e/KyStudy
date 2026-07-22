use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, params};

use crate::application::{
    AnalyticsBacklog, AnalyticsError, AnalyticsOverview, AnalyticsPeriodSummary,
    AnalyticsRepository, DailyAnalyticsPoint, KnowledgeAnalytics, RepeatedMistakeAnalytics,
    SubjectAnalytics, rounded_percent,
};
use crate::domain::{DateRange, LocalDate, SubjectColor};

use super::sqlite_workspace::{SqliteWorkspaceRepository, database_error, migrate, open_database};

#[derive(Debug, Clone)]
pub(crate) struct SqliteAnalyticsRepository {
    database_path: PathBuf,
}

impl SqliteAnalyticsRepository {
    pub(crate) fn new(application_data_directory: &Path) -> Self {
        let workspace = SqliteWorkspaceRepository::new(application_data_directory);
        Self {
            database_path: workspace.database_path(),
        }
    }

    fn open(&self) -> Result<Connection, AnalyticsError> {
        if !self.database_path.exists() {
            return Err(AnalyticsError::WorkspaceNotInitialized);
        }
        let mut connection = open_database(&self.database_path, false)?;
        migrate(&mut connection)?;
        Ok(connection)
    }
}

impl AnalyticsRepository for SqliteAnalyticsRepository {
    fn load(
        &self,
        current: &DateRange,
        previous: &DateRange,
        today: &LocalDate,
    ) -> Result<AnalyticsOverview, AnalyticsError> {
        let connection = self.open()?;
        let workspace_id = load_workspace_id(&connection)?;
        let daily = load_daily_points(&connection, &workspace_id, current)?;
        let previous_daily = load_daily_points(&connection, &workspace_id, previous)?;
        Ok(AnalyticsOverview {
            range_start: current.start.as_str().to_owned(),
            range_end: current.end.as_str().to_owned(),
            previous_range_start: previous.start.as_str().to_owned(),
            previous_range_end: previous.end.as_str().to_owned(),
            current: summarize(&daily)?,
            previous: summarize(&previous_daily)?,
            backlog: load_backlog(&connection, &workspace_id, today)?,
            subjects: load_subjects(&connection, &workspace_id, current)?,
            knowledge: load_knowledge(&connection, current)?,
            repeated_mistakes: load_repeated_mistakes(&connection)?,
            daily,
        })
    }
}

fn load_daily_points(
    connection: &Connection,
    workspace_id: &str,
    range: &DateRange,
) -> Result<Vec<DailyAnalyticsPoint>, AnalyticsError> {
    let mut statement = connection
        .prepare(
            "WITH RECURSIVE dates(day) AS (
                SELECT ?2
                UNION ALL SELECT date(day, '+1 day') FROM dates WHERE day < ?3
             ), task_totals AS (
                SELECT planned_date AS day, COUNT(*) AS task_count,
                       SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS completed_count,
                       COALESCE(SUM(estimated_minutes), 0) AS planned_minutes
                FROM task
                WHERE workspace_id = ?1 AND planned_date BETWEEN ?2 AND ?3
                  AND status <> 'canceled' AND deleted_at IS NULL
                GROUP BY planned_date
             ), session_totals AS (
                SELECT session_date AS day, SUM(duration_minutes) AS actual_minutes
                FROM study_session
                WHERE workspace_id = ?1 AND session_date BETWEEN ?2 AND ?3
                  AND deleted_at IS NULL
                GROUP BY session_date
             ), attempt_totals AS (
                SELECT date(a.attempted_at / 1000, 'unixepoch', '+8 hours') AS day,
                       COUNT(*) AS attempt_count,
                       SUM(CASE WHEN a.result = 'correct' THEN 1 ELSE 0 END) AS correct_count
                FROM question_attempt a
                JOIN question q ON q.id = a.question_id
                WHERE q.workspace_id = ?1 AND q.deleted_at IS NULL
                  AND day BETWEEN ?2 AND ?3
                GROUP BY day
             ), review_totals AS (
                SELECT q.queue_date AS day, COUNT(i.question_id) AS item_count,
                       SUM(CASE WHEN i.state = 'completed' THEN 1 ELSE 0 END) AS completed_count
                FROM daily_review_queue q
                LEFT JOIN daily_review_item i ON i.queue_id = q.id
                WHERE q.workspace_id = ?1 AND q.queue_date BETWEEN ?2 AND ?3
                GROUP BY q.queue_date
             ), ai_totals AS (
                SELECT date(c.started_at / 1000, 'unixepoch', '+8 hours') AS day,
                       SUM(u.input_tokens + u.output_tokens) AS token_count
                FROM ai_call c JOIN ai_usage u ON u.ai_call_id = c.id
                WHERE day BETWEEN ?2 AND ?3
                GROUP BY day
             )
             SELECT dates.day,
                    COALESCE(t.task_count, 0), COALESCE(t.completed_count, 0),
                    COALESCE(t.planned_minutes, 0), COALESCE(s.actual_minutes, 0),
                    COALESCE(a.attempt_count, 0), COALESCE(a.correct_count, 0),
                    COALESCE(r.item_count, 0), COALESCE(r.completed_count, 0),
                    COALESCE(ai.token_count, 0)
             FROM dates
             LEFT JOIN task_totals t ON t.day = dates.day
             LEFT JOIN session_totals s ON s.day = dates.day
             LEFT JOIN attempt_totals a ON a.day = dates.day
             LEFT JOIN review_totals r ON r.day = dates.day
             LEFT JOIN ai_totals ai ON ai.day = dates.day
             ORDER BY dates.day",
        )
        .map_err(database_error)?;
    statement
        .query_map(
            params![workspace_id, range.start.as_str(), range.end.as_str()],
            |row| {
                Ok(DailyAnalyticsPoint {
                    date: row.get(0)?,
                    task_count: read_u32(row, 1)?,
                    completed_task_count: read_u32(row, 2)?,
                    planned_minutes: read_u32(row, 3)?,
                    actual_minutes: read_u32(row, 4)?,
                    attempt_count: read_u32(row, 5)?,
                    correct_attempt_count: read_u32(row, 6)?,
                    review_item_count: read_u32(row, 7)?,
                    completed_review_count: read_u32(row, 8)?,
                    ai_tokens: read_u64(row, 9)?,
                })
            },
        )
        .map_err(database_error)?
        .map(|row| row.map_err(database_error).map_err(Into::into))
        .collect()
}

fn summarize(points: &[DailyAnalyticsPoint]) -> Result<AnalyticsPeriodSummary, AnalyticsError> {
    let mut task_count = 0_u64;
    let mut completed_task_count = 0_u64;
    let mut planned_minutes = 0_u64;
    let mut actual_minutes = 0_u64;
    let mut attempt_count = 0_u64;
    let mut correct_attempt_count = 0_u64;
    let mut review_item_count = 0_u64;
    let mut completed_review_count = 0_u64;
    let mut ai_tokens = 0_u64;
    for point in points {
        task_count += u64::from(point.task_count);
        completed_task_count += u64::from(point.completed_task_count);
        planned_minutes += u64::from(point.planned_minutes);
        actual_minutes += u64::from(point.actual_minutes);
        attempt_count += u64::from(point.attempt_count);
        correct_attempt_count += u64::from(point.correct_attempt_count);
        review_item_count += u64::from(point.review_item_count);
        completed_review_count += u64::from(point.completed_review_count);
        ai_tokens = ai_tokens.saturating_add(point.ai_tokens);
    }
    let task_count = checked_u32(task_count)?;
    let completed_task_count = checked_u32(completed_task_count)?;
    let attempt_count = checked_u32(attempt_count)?;
    let correct_attempt_count = checked_u32(correct_attempt_count)?;
    let review_item_count = checked_u32(review_item_count)?;
    let completed_review_count = checked_u32(completed_review_count)?;
    Ok(AnalyticsPeriodSummary {
        task_count,
        completed_task_count,
        completion_rate_percent: rounded_percent(completed_task_count, task_count),
        planned_minutes: checked_u32(planned_minutes)?,
        actual_minutes: checked_u32(actual_minutes)?,
        attempt_count,
        correct_attempt_count,
        accuracy_percent: rounded_percent(correct_attempt_count, attempt_count),
        review_item_count,
        completed_review_count,
        review_completion_percent: rounded_percent(completed_review_count, review_item_count),
        ai_tokens,
    })
}

fn load_backlog(
    connection: &Connection,
    workspace_id: &str,
    today: &LocalDate,
) -> Result<AnalyticsBacklog, AnalyticsError> {
    connection
        .query_row(
            "SELECT
                (SELECT COUNT(*) FROM task
                 WHERE workspace_id = ?1 AND planned_date < ?2
                   AND status IN ('todo', 'in_progress') AND deleted_at IS NULL),
                (SELECT COUNT(*) FROM mistake_profile m
                 JOIN question q ON q.id = m.question_id
                 WHERE q.workspace_id = ?1 AND q.deleted_at IS NULL AND m.active = 1),
                (SELECT COUNT(*) FROM review_state r
                 JOIN mistake_profile m ON m.question_id = r.question_id
                 JOIN question q ON q.id = r.question_id
                 WHERE q.workspace_id = ?1 AND q.deleted_at IS NULL
                   AND m.active = 1 AND r.suspended_at IS NULL AND r.due_date <= ?2),
                (SELECT COUNT(*) FROM daily_review_item i
                 JOIN daily_review_queue q ON q.id = i.queue_id
                 WHERE q.workspace_id = ?1 AND q.queue_date = ?2 AND i.state = 'pending')",
            params![workspace_id, today.as_str()],
            |row| {
                Ok(AnalyticsBacklog {
                    overdue_tasks: read_u32(row, 0)?,
                    active_mistakes: read_u32(row, 1)?,
                    due_reviews: read_u32(row, 2)?,
                    queued_reviews: read_u32(row, 3)?,
                })
            },
        )
        .map_err(database_error)
        .map_err(Into::into)
}

fn load_subjects(
    connection: &Connection,
    workspace_id: &str,
    range: &DateRange,
) -> Result<Vec<SubjectAnalytics>, AnalyticsError> {
    let mut statement = connection
        .prepare(
            "WITH task_totals AS (
                SELECT subject_id, COUNT(*) AS task_count,
                       SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS completed_count
                FROM task WHERE workspace_id = ?1 AND planned_date BETWEEN ?2 AND ?3
                  AND status <> 'canceled' AND deleted_at IS NULL GROUP BY subject_id
             ), session_totals AS (
                SELECT subject_id, SUM(duration_minutes) AS actual_minutes
                FROM study_session WHERE workspace_id = ?1 AND session_date BETWEEN ?2 AND ?3
                  AND deleted_at IS NULL GROUP BY subject_id
             )
             SELECT s.id, s.name, s.color_key,
                    COALESCE(t.task_count, 0), COALESCE(t.completed_count, 0),
                    COALESCE(ss.actual_minutes, 0)
             FROM subject s
             LEFT JOIN task_totals t ON t.subject_id = s.id
             LEFT JOIN session_totals ss ON ss.subject_id = s.id
             WHERE s.workspace_id = ?1
               AND (COALESCE(t.task_count, 0) > 0 OR COALESCE(ss.actual_minutes, 0) > 0)
             ORDER BY s.sort_order, s.created_at, s.id",
        )
        .map_err(database_error)?;
    let rows = statement
        .query_map(
            params![workspace_id, range.start.as_str(), range.end.as_str()],
            |row| {
                let task_count = read_u32(row, 3)?;
                let completed = read_u32(row, 4)?;
                let color = row.get::<_, String>(2)?;
                Ok(SubjectAnalytics {
                    subject_id: Some(row.get(0)?),
                    subject_name: row.get(1)?,
                    color: SubjectColor::parse(&color).ok_or(rusqlite::Error::InvalidQuery)?,
                    task_count,
                    completed_task_count: completed,
                    completion_rate_percent: rounded_percent(completed, task_count),
                    actual_minutes: read_u32(row, 5)?,
                })
            },
        )
        .map_err(database_error)?;
    let mut subjects = rows
        .map(|row| row.map_err(database_error).map_err(Into::into))
        .collect::<Result<Vec<_>, AnalyticsError>>()?;
    let (task_count, completed, actual_minutes) = connection
        .query_row(
            "SELECT
                (SELECT COUNT(*) FROM task WHERE workspace_id = ?1 AND subject_id IS NULL
                 AND planned_date BETWEEN ?2 AND ?3 AND status <> 'canceled' AND deleted_at IS NULL),
                (SELECT COUNT(*) FROM task WHERE workspace_id = ?1 AND subject_id IS NULL
                 AND planned_date BETWEEN ?2 AND ?3 AND status = 'done' AND deleted_at IS NULL),
                (SELECT COALESCE(SUM(duration_minutes), 0) FROM study_session
                 WHERE workspace_id = ?1 AND subject_id IS NULL
                   AND session_date BETWEEN ?2 AND ?3 AND deleted_at IS NULL)",
            params![workspace_id, range.start.as_str(), range.end.as_str()],
            |row| Ok((read_u32(row, 0)?, read_u32(row, 1)?, read_u32(row, 2)?)),
        )
        .map_err(database_error)?;
    if task_count > 0 || actual_minutes > 0 {
        subjects.push(SubjectAnalytics {
            subject_id: None,
            subject_name: "未分类".to_owned(),
            color: SubjectColor::Slate,
            task_count,
            completed_task_count: completed,
            completion_rate_percent: rounded_percent(completed, task_count),
            actual_minutes,
        });
    }
    Ok(subjects)
}

fn load_knowledge(
    connection: &Connection,
    range: &DateRange,
) -> Result<Vec<KnowledgeAnalytics>, AnalyticsError> {
    let mut statement = connection
        .prepare(
            "WITH question_totals AS (
                SELECT l.node_id, COUNT(DISTINCT q.id) AS question_count
                FROM question_knowledge_node l JOIN question q ON q.id = l.question_id
                WHERE q.deleted_at IS NULL GROUP BY l.node_id
             ), attempt_totals AS (
                SELECT l.node_id, COUNT(a.id) AS attempt_count,
                       SUM(CASE WHEN a.result = 'correct' THEN 1 ELSE 0 END) AS correct_count
                FROM question_knowledge_node l
                JOIN question q ON q.id = l.question_id AND q.deleted_at IS NULL
                JOIN question_attempt a ON a.question_id = q.id
                WHERE date(a.attempted_at / 1000, 'unixepoch', '+8 hours') BETWEEN ?1 AND ?2
                GROUP BY l.node_id
             ), mistake_totals AS (
                SELECT l.node_id, COUNT(DISTINCT m.question_id) AS active_mistakes
                FROM question_knowledge_node l
                JOIN question q ON q.id = l.question_id AND q.deleted_at IS NULL
                JOIN mistake_profile m ON m.question_id = q.id AND m.active = 1
                GROUP BY l.node_id
             )
             SELECT n.id, n.title, m.id, m.title, s.name,
                    COALESCE(q.question_count, 0), COALESCE(a.attempt_count, 0),
                    COALESCE(a.correct_count, 0), COALESCE(mt.active_mistakes, 0)
             FROM knowledge_node n
             JOIN knowledge_map m ON m.id = n.map_id AND m.deleted_at IS NULL
             LEFT JOIN subject s ON s.id = COALESCE(n.subject_id, m.subject_id)
             LEFT JOIN question_totals q ON q.node_id = n.id
             LEFT JOIN attempt_totals a ON a.node_id = n.id
             LEFT JOIN mistake_totals mt ON mt.node_id = n.id
             WHERE COALESCE(q.question_count, 0) > 0
               AND (COALESCE(a.attempt_count, 0) > 0 OR COALESCE(mt.active_mistakes, 0) > 0)
             ORDER BY COALESCE(mt.active_mistakes, 0) DESC,
                      COALESCE(a.attempt_count, 0) DESC, n.title, n.id
             LIMIT 20",
        )
        .map_err(database_error)?;
    statement
        .query_map(params![range.start.as_str(), range.end.as_str()], |row| {
            let attempts = read_u32(row, 6)?;
            let correct = read_u32(row, 7)?;
            Ok(KnowledgeAnalytics {
                node_id: row.get(0)?,
                node_title: row.get(1)?,
                map_id: row.get(2)?,
                map_title: row.get(3)?,
                subject_name: row.get(4)?,
                question_count: read_u32(row, 5)?,
                attempt_count: attempts,
                correct_attempt_count: correct,
                accuracy_percent: rounded_percent(correct, attempts),
                active_mistake_count: read_u32(row, 8)?,
            })
        })
        .map_err(database_error)?
        .map(|row| row.map_err(database_error).map_err(Into::into))
        .collect()
}

fn load_repeated_mistakes(
    connection: &Connection,
) -> Result<Vec<RepeatedMistakeAnalytics>, AnalyticsError> {
    let mut statement = connection
        .prepare(
            "SELECT q.id, q.title, q.document_id, d.title,
                    m.mistake_count, m.consecutive_failure_count,
                    r.mastery_level, r.due_date, m.last_mistake_at
             FROM mistake_profile m
             JOIN question q ON q.id = m.question_id AND q.deleted_at IS NULL
             JOIN resource_document d ON d.id = q.document_id
             JOIN review_state r ON r.question_id = q.id
             WHERE m.active = 1 AND (m.mistake_count >= 2 OR m.consecutive_failure_count > 0)
             ORDER BY m.consecutive_failure_count DESC, m.mistake_count DESC,
                      m.last_mistake_at DESC, q.id
             LIMIT 12",
        )
        .map_err(database_error)?;
    statement
        .query_map([], |row| {
            let mastery = row.get::<_, String>(6)?;
            if !matches!(
                mastery.as_str(),
                "new" | "learning" | "uncertain" | "mastered"
            ) {
                return Err(rusqlite::Error::InvalidQuery);
            }
            Ok(RepeatedMistakeAnalytics {
                question_id: row.get(0)?,
                question_title: row.get(1)?,
                document_id: row.get(2)?,
                document_title: row.get(3)?,
                mistake_count: read_u32(row, 4)?,
                consecutive_failure_count: read_u32(row, 5)?,
                mastery,
                due_date: row.get(7)?,
                last_mistake_at: row.get(8)?,
            })
        })
        .map_err(database_error)?
        .map(|row| row.map_err(database_error).map_err(Into::into))
        .collect()
}

fn load_workspace_id(connection: &Connection) -> Result<String, AnalyticsError> {
    connection
        .query_row(
            "SELECT id FROM workspace WHERE singleton_key = 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(database_error)?
        .ok_or(AnalyticsError::WorkspaceNotInitialized)
}

fn read_u32(row: &rusqlite::Row<'_>, index: usize) -> rusqlite::Result<u32> {
    let value = row.get::<_, i64>(index)?;
    u32::try_from(value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Integer,
            Box::new(error),
        )
    })
}

fn read_u64(row: &rusqlite::Row<'_>, index: usize) -> rusqlite::Result<u64> {
    let value = row.get::<_, i64>(index)?;
    u64::try_from(value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Integer,
            Box::new(error),
        )
    })
}

fn checked_u32(value: u64) -> Result<u32, AnalyticsError> {
    u32::try_from(value).map_err(|_| AnalyticsError::InvalidStoredData)
}

#[cfg(test)]
mod tests {
    use rusqlite::params;
    use tempfile::tempdir;

    use super::SqliteAnalyticsRepository;
    use crate::application::{AnalyticsInput, AnalyticsUseCases, WorkspaceRepository};
    use crate::domain::NewWorkspace;
    use crate::infrastructure::SqliteWorkspaceRepository;

    #[test]
    fn overview_combines_period_activity_and_current_backlog_without_fake_rates() {
        let directory = tempdir().expect("temporary directory should exist");
        SqliteWorkspaceRepository::new(directory.path())
            .initialize_default(&NewWorkspace::default_at(1_700_000_000_000))
            .expect("workspace should initialize");
        let repository = SqliteAnalyticsRepository::new(directory.path());
        let connection = repository.open().expect("database should open");
        let workspace_id = connection
            .query_row(
                "SELECT id FROM workspace WHERE singleton_key = 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .expect("workspace id should load");
        let subject_id = uuid::Uuid::now_v7().to_string();
        let completed_task_id = uuid::Uuid::now_v7().to_string();
        connection
            .execute(
                "INSERT INTO subject(
                    id, workspace_id, name, color_key, sort_order, created_at, updated_at
                 ) VALUES (?1, ?2, '408', 'blue', 0, 1, 1)",
                params![subject_id, workspace_id],
            )
            .expect("subject should insert");
        connection
            .execute(
                "INSERT INTO task(
                    id, workspace_id, subject_id, title, planned_date, estimated_minutes,
                    priority, status, manual_order, source_type, completed_at, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, '完成一章', '2026-07-20', 60,
                    'normal', 'done', 0, 'manual', 2, 1, 2)",
                params![completed_task_id, workspace_id, subject_id],
            )
            .expect("completed task should insert");
        connection
            .execute(
                "INSERT INTO task(
                    id, workspace_id, subject_id, title, planned_date, estimated_minutes,
                    priority, status, manual_order, source_type, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, '逾期任务', '2026-07-01', 30,
                    'high', 'todo', 0, 'manual', 1, 1)",
                params![uuid::Uuid::now_v7().to_string(), workspace_id, subject_id],
            )
            .expect("overdue task should insert");
        connection
            .execute(
                "INSERT INTO study_session(
                    id, workspace_id, task_id, subject_id, session_date,
                    duration_minutes, completion_percent, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, '2026-07-20', 45, 100, 2, 2)",
                params![
                    uuid::Uuid::now_v7().to_string(),
                    workspace_id,
                    completed_task_id,
                    subject_id
                ],
            )
            .expect("study session should insert");
        drop(connection);

        let overview = AnalyticsUseCases::new(repository)
            .overview(&AnalyticsInput {
                today: "2026-07-22".to_owned(),
                days: 7,
            })
            .expect("analytics should load");

        assert_eq!(overview.range_start, "2026-07-16");
        assert_eq!(overview.daily.len(), 7);
        assert_eq!(overview.current.completion_rate_percent, Some(100));
        assert_eq!(overview.current.actual_minutes, 45);
        assert_eq!(overview.previous.completion_rate_percent, None);
        assert_eq!(overview.backlog.overdue_tasks, 1);
        assert_eq!(overview.subjects[0].subject_name, "408");
    }
}
