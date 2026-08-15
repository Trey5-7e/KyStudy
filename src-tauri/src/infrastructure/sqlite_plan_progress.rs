use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, params};

use crate::application::{
    PlanProgressCounts, PlanProgressError, PlanProgressRecord, PlanProgressRepository,
    PlanStageProgress,
};
use crate::domain::{LocalDate, PlanStatus};

use super::sqlite_workspace::{SqliteWorkspaceRepository, database_error, migrate, open_database};

#[derive(Debug, Clone)]
pub(crate) struct SqlitePlanProgressRepository {
    database_path: PathBuf,
}

impl SqlitePlanProgressRepository {
    pub(crate) fn new(application_data_directory: &Path) -> Self {
        let workspace = SqliteWorkspaceRepository::new(application_data_directory);
        Self {
            database_path: workspace.database_path(),
        }
    }

    fn open(&self) -> Result<Connection, PlanProgressError> {
        if !self.database_path.exists() {
            return Err(PlanProgressError::WorkspaceNotInitialized);
        }
        let mut connection = open_database(&self.database_path, false)?;
        migrate(&mut connection)?;
        Ok(connection)
    }
}

impl PlanProgressRepository for SqlitePlanProgressRepository {
    fn load(
        &self,
        plan_id: &str,
        today: &LocalDate,
    ) -> Result<PlanProgressRecord, PlanProgressError> {
        let connection = self.open()?;
        let workspace_id = load_workspace_id(&connection)?;
        let (plan_title, raw_status) = connection
            .query_row(
                "SELECT title, status FROM study_plan WHERE id = ?1 AND workspace_id = ?2",
                params![plan_id, workspace_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(database_error)?
            .ok_or(PlanProgressError::PlanNotFound)?;
        let plan_status =
            PlanStatus::parse(&raw_status).ok_or(PlanProgressError::InvalidStoredData)?;
        let stages = load_stage_progress(&connection, plan_id, &workspace_id, today)?;
        Ok(PlanProgressRecord {
            plan_id: plan_id.to_owned(),
            plan_title,
            plan_status,
            stages,
        })
    }
}

fn load_stage_progress(
    connection: &Connection,
    plan_id: &str,
    workspace_id: &str,
    today: &LocalDate,
) -> Result<Vec<PlanStageProgress>, PlanProgressError> {
    let mut statement = connection
        .prepare(
            "WITH task_sessions AS (
                SELECT task_id, SUM(duration_minutes) AS actual_minutes
                FROM study_session
                WHERE deleted_at IS NULL AND task_id IS NOT NULL
                GROUP BY task_id
             )
             SELECT s.id, s.title, s.start_date, s.end_date,
                    COUNT(pst.task_id), COUNT(t.id),
                    COALESCE(SUM(CASE WHEN t.deleted_at IS NULL AND t.status <> 'canceled'
                        THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN t.deleted_at IS NULL AND t.status = 'done'
                        THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN t.deleted_at IS NULL
                        AND t.status IN ('todo', 'in_progress') THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN t.deleted_at IS NULL
                        AND t.status IN ('todo', 'in_progress') AND t.planned_date < ?3
                        THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN t.deleted_at IS NULL AND t.status = 'canceled'
                        THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN t.deleted_at IS NOT NULL THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN t.deleted_at IS NULL AND t.status <> 'canceled'
                        THEN COALESCE(t.estimated_minutes, 0) ELSE 0 END), 0),
                    COALESCE(SUM(COALESCE(ts.actual_minutes, 0)), 0)
             FROM plan_stage s
             JOIN study_plan p ON p.id = s.plan_id
             LEFT JOIN plan_stage_task pst ON pst.stage_id = s.id
             LEFT JOIN task t ON t.id = pst.task_id AND t.workspace_id = p.workspace_id
             LEFT JOIN task_sessions ts ON ts.task_id = t.id
             WHERE s.plan_id = ?1 AND p.workspace_id = ?2
             GROUP BY s.id, s.title, s.start_date, s.end_date, s.sort_order
             ORDER BY s.sort_order, s.start_date, s.id",
        )
        .map_err(database_error)?;
    let rows = statement
        .query_map(params![plan_id, workspace_id, today.as_str()], |row| {
            Ok(RawStageProgress {
                stage_id: row.get(0)?,
                stage_title: row.get(1)?,
                start_date: row.get(2)?,
                end_date: row.get(3)?,
                origin_count: read_u32(row, 4)?,
                generated_task_count: read_u32(row, 5)?,
                effective_task_count: read_u32(row, 6)?,
                completed_task_count: read_u32(row, 7)?,
                remaining_task_count: read_u32(row, 8)?,
                overdue_task_count: read_u32(row, 9)?,
                canceled_task_count: read_u32(row, 10)?,
                trashed_task_count: read_u32(row, 11)?,
                planned_minutes: read_u32(row, 12)?,
                actual_minutes: read_u32(row, 13)?,
            })
        })
        .map_err(database_error)?;
    rows.map(|row| stage_from_raw(row.map_err(database_error)?))
        .collect()
}

#[derive(Debug)]
struct RawStageProgress {
    stage_id: String,
    stage_title: String,
    start_date: String,
    end_date: String,
    origin_count: u32,
    generated_task_count: u32,
    effective_task_count: u32,
    completed_task_count: u32,
    remaining_task_count: u32,
    overdue_task_count: u32,
    canceled_task_count: u32,
    trashed_task_count: u32,
    planned_minutes: u32,
    actual_minutes: u32,
}

fn stage_from_raw(raw: RawStageProgress) -> Result<PlanStageProgress, PlanProgressError> {
    if raw.origin_count != raw.generated_task_count {
        return Err(PlanProgressError::InvalidStoredData);
    }
    PlanStageProgress::new(
        raw.stage_id,
        raw.stage_title,
        LocalDate::parse(&raw.start_date).map_err(|_| PlanProgressError::InvalidStoredData)?,
        LocalDate::parse(&raw.end_date).map_err(|_| PlanProgressError::InvalidStoredData)?,
        PlanProgressCounts {
            generated_task_count: raw.generated_task_count,
            effective_task_count: raw.effective_task_count,
            completed_task_count: raw.completed_task_count,
            remaining_task_count: raw.remaining_task_count,
            overdue_task_count: raw.overdue_task_count,
            canceled_task_count: raw.canceled_task_count,
            trashed_task_count: raw.trashed_task_count,
            planned_minutes: raw.planned_minutes,
            actual_minutes: raw.actual_minutes,
        },
    )
}

fn load_workspace_id(connection: &Connection) -> Result<String, PlanProgressError> {
    connection
        .query_row(
            "SELECT id FROM workspace WHERE singleton_key = 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(database_error)?
        .ok_or(PlanProgressError::WorkspaceNotInitialized)
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

#[cfg(test)]
mod tests {
    use rusqlite::{Connection, params};
    use tempfile::tempdir;

    use super::SqlitePlanProgressRepository;
    use crate::application::{
        PlanProgressInput, PlanProgressUseCases, PlanScheduleUseCases, PlanTaskScheduleInput,
        PlanningUseCases, SavePlanInput, SavePlanStageInput, WorkspaceRepository,
    };
    use crate::domain::NewWorkspace;
    use crate::infrastructure::{
        SqlitePlanningRepository, SqliteScheduleRepository, SqliteWorkspaceRepository,
    };

    fn insert_session(
        connection: &Connection,
        task_id: &str,
        session_date: &str,
        duration_minutes: u32,
        timestamp: i64,
    ) {
        connection
            .execute(
                "INSERT INTO study_session(
                    id, workspace_id, task_id, session_date, duration_minutes,
                    completion_percent, created_at, updated_at
                 ) SELECT ?1, workspace_id, id, ?3, ?4, 50, ?5, ?5
                   FROM task WHERE id = ?2",
                params![
                    uuid::Uuid::now_v7().to_string(),
                    task_id,
                    session_date,
                    duration_minutes,
                    timestamp
                ],
            )
            .expect("study session should persist");
    }

    #[test]
    fn overview_keeps_real_effort_and_excludes_canceled_or_trashed_tasks_from_completion() {
        let directory = tempdir().expect("temporary directory should exist");
        let workspace = SqliteWorkspaceRepository::new(directory.path());
        workspace
            .initialize_default(&NewWorkspace::default_at(1_700_000_000_000))
            .expect("workspace should initialize");
        let planning = PlanningUseCases::new(SqlitePlanningRepository::new(directory.path()));
        let plan = planning
            .save_plan(SavePlanInput {
                id: None,
                expected_revision: None,
                title: "408 计划".to_owned(),
                target_exam: None,
                exam_date: None,
                overview: None,
            })
            .expect("plan should persist");
        let stage = planning
            .save_stage(SavePlanStageInput {
                id: None,
                plan_id: plan.plan.id.clone(),
                expected_plan_revision: plan.plan.revision,
                title: "基础阶段".to_owned(),
                start_date: "2026-07-20".to_owned(),
                end_date: "2026-07-26".to_owned(),
                focus: None,
                sort_order: 0,
            })
            .expect("stage should persist");
        planning
            .set_status(&plan.plan.id, plan.plan.revision + 1, "active")
            .expect("plan should become active");
        let creation = PlanScheduleUseCases::new(SqliteScheduleRepository::new(directory.path()))
            .confirm(&PlanTaskScheduleInput {
                stage_id: stage.id,
                subject_id: None,
                start_date: "2026-07-20".to_owned(),
                end_date: "2026-07-23".to_owned(),
                weekdays: vec![0, 1, 2, 3],
                title: "阶段任务".to_owned(),
                description: None,
                estimated_minutes: Some(60),
                priority: "normal".to_owned(),
            })
            .expect("four tasks should be created");
        let connection = Connection::open(workspace.database_path()).expect("database should open");
        connection
            .execute(
                "UPDATE task SET status = 'done', completed_at = created_at WHERE id = ?1",
                [&creation.created_tasks[0].id],
            )
            .expect("first task should complete");
        connection
            .execute(
                "UPDATE task SET status = 'canceled' WHERE id = ?1",
                [&creation.created_tasks[1].id],
            )
            .expect("second task should cancel");
        connection
            .execute(
                "UPDATE task SET deleted_at = created_at WHERE id = ?1",
                [&creation.created_tasks[2].id],
            )
            .expect("third task should enter trash");
        insert_session(
            &connection,
            &creation.created_tasks[1].id,
            "2026-07-21",
            25,
            3,
        );
        insert_session(
            &connection,
            &creation.created_tasks[2].id,
            "2026-07-22",
            15,
            4,
        );
        drop(connection);

        let overview =
            PlanProgressUseCases::new(SqlitePlanProgressRepository::new(directory.path()))
                .overview(&PlanProgressInput {
                    plan_id: plan.plan.id,
                    today: "2026-07-27".to_owned(),
                })
                .expect("progress should load");
        let summary = &overview.summary;

        assert_eq!(summary.counts.generated_task_count, 4);
        assert_eq!(summary.counts.effective_task_count, 2);
        assert_eq!(summary.counts.completed_task_count, 1);
        assert_eq!(summary.counts.remaining_task_count, 1);
        assert_eq!(summary.counts.overdue_task_count, 1);
        assert_eq!(summary.counts.canceled_task_count, 1);
        assert_eq!(summary.counts.trashed_task_count, 1);
        assert_eq!(summary.counts.planned_minutes, 120);
        assert_eq!(summary.counts.actual_minutes, 40);
        assert_eq!(summary.completion_rate_percent, Some(50));
    }
}
