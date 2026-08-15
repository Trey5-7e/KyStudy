use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};

use crate::application::{PlanningError, PlanningRepository};
use crate::domain::{PlanReference, PlanStage, PlanStatus, StudyPlan, StudyPlanBundle};

use super::sqlite_workspace::{SqliteWorkspaceRepository, database_error, migrate, open_database};

/// `SQLite` adapter for personal plans, stages, and page-range references.
#[derive(Debug, Clone)]
pub(crate) struct SqlitePlanningRepository {
    database_path: PathBuf,
}

impl SqlitePlanningRepository {
    pub(crate) fn new(application_data_directory: &Path) -> Self {
        let workspace = SqliteWorkspaceRepository::new(application_data_directory);
        Self {
            database_path: workspace.database_path(),
        }
    }

    fn open(&self) -> Result<Connection, PlanningError> {
        if !self.database_path.exists() {
            return Err(PlanningError::WorkspaceNotInitialized);
        }
        let mut connection = open_database(&self.database_path, false)?;
        migrate(&mut connection)?;
        Ok(connection)
    }
}

impl PlanningRepository for SqlitePlanningRepository {
    fn list_plans(&self) -> Result<Vec<StudyPlanBundle>, PlanningError> {
        if !self.database_path.exists() {
            return Ok(Vec::new());
        }
        let connection = self.open()?;
        let mut statement = connection
            .prepare(
                "SELECT id, title, target_exam, exam_date, overview, status,
                        revision, created_at, updated_at
                 FROM study_plan
                 ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
                          updated_at DESC, id DESC",
            )
            .map_err(database_error)?;
        let rows = statement
            .query_map([], map_plan_row)
            .map_err(database_error)?;
        let plans = rows
            .map(|row| row.map_err(database_error))
            .collect::<Result<Vec<_>, _>>()?;
        plans
            .into_iter()
            .map(|plan| load_bundle_for_plan(&connection, plan))
            .collect()
    }

    fn save_plan(
        &self,
        plan: StudyPlan,
        expected_revision: Option<u32>,
    ) -> Result<StudyPlanBundle, PlanningError> {
        let connection = self.open()?;
        let workspace_id = load_workspace_id(&connection)?;
        let changed = connection
            .execute(
                "INSERT INTO study_plan(
                    id, workspace_id, title, target_exam, exam_date, overview,
                    status, revision, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'draft', 1, ?7, ?7)
                 ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title,
                    target_exam = excluded.target_exam,
                    exam_date = excluded.exam_date,
                    overview = excluded.overview,
                    revision = study_plan.revision + 1,
                    updated_at = excluded.updated_at
                 WHERE study_plan.workspace_id = excluded.workspace_id
                   AND study_plan.revision = ?8",
                params![
                    plan.id,
                    workspace_id,
                    plan.title,
                    plan.target_exam,
                    plan.exam_date,
                    plan.overview,
                    plan.updated_at,
                    expected_revision.map(i64::from)
                ],
            )
            .map_err(database_error)?;
        if changed != 1 {
            let exists = connection
                .query_row(
                    "SELECT 1 FROM study_plan WHERE id = ?1 AND workspace_id = ?2",
                    params![plan.id, workspace_id],
                    |_| Ok(()),
                )
                .optional()
                .map_err(database_error)?;
            return match exists {
                Some(()) => Err(PlanningError::PlanSaveStale),
                None => Err(PlanningError::PlanNotFound),
            };
        }
        load_bundle(&connection, &plan.id)
    }

    fn set_plan_status(
        &self,
        plan_id: &str,
        expected_revision: u32,
        status: PlanStatus,
        updated_at: i64,
    ) -> Result<StudyPlanBundle, PlanningError> {
        let mut connection = self.open()?;
        let workspace_id = load_workspace_id(&connection)?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let target_exists = transaction
            .query_row(
                "SELECT 1 FROM study_plan
                 WHERE id = ?1 AND workspace_id = ?2 AND revision = ?3",
                params![plan_id, workspace_id, i64::from(expected_revision)],
                |_| Ok(()),
            )
            .optional()
            .map_err(database_error)?;
        if target_exists.is_none() {
            let exists = transaction
                .query_row(
                    "SELECT 1 FROM study_plan WHERE id = ?1 AND workspace_id = ?2",
                    params![plan_id, workspace_id],
                    |_| Ok(()),
                )
                .optional()
                .map_err(database_error)?;
            return match exists {
                Some(()) => Err(PlanningError::PlanSaveStale),
                None => Err(PlanningError::PlanNotFound),
            };
        }
        if status == PlanStatus::Active {
            transaction
                .execute(
                    "UPDATE study_plan
                     SET status = 'draft', revision = revision + 1, updated_at = ?2
                     WHERE workspace_id = ?1 AND status = 'active' AND id <> ?3",
                    params![workspace_id, updated_at, plan_id],
                )
                .map_err(database_error)?;
        }
        let changed = transaction
            .execute(
                "UPDATE study_plan
                 SET status = ?2, revision = revision + 1, updated_at = ?3
                 WHERE id = ?1 AND workspace_id = ?4 AND revision = ?5",
                params![
                    plan_id,
                    status.as_str(),
                    updated_at,
                    workspace_id,
                    i64::from(expected_revision)
                ],
            )
            .map_err(database_error)?;
        if changed == 0 {
            return Err(PlanningError::PlanNotFound);
        }
        transaction.commit().map_err(database_error)?;
        load_bundle(&connection, plan_id)
    }

    fn save_stage(
        &self,
        stage: PlanStage,
        expected_plan_revision: u32,
    ) -> Result<PlanStage, PlanningError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        validate_and_bump_plan(
            &transaction,
            &stage.plan_id,
            expected_plan_revision,
            stage.updated_at,
        )?;
        let existed = transaction
            .query_row(
                "SELECT plan_id, created_at FROM plan_stage WHERE id = ?1",
                params![stage.id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()
            .map_err(database_error)?;
        if let Some((plan_id, _)) = &existed
            && plan_id != &stage.plan_id
        {
            return Err(PlanningError::StageNotFound);
        }
        let created_at = existed.map_or(stage.created_at, |(_, created_at)| created_at);
        transaction
            .execute(
                "INSERT INTO plan_stage(
                    id, plan_id, title, start_date, end_date, focus, sort_order,
                    created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title,
                    start_date = excluded.start_date,
                    end_date = excluded.end_date,
                    focus = excluded.focus,
                    sort_order = excluded.sort_order,
                    updated_at = excluded.updated_at",
                params![
                    stage.id,
                    stage.plan_id,
                    stage.title,
                    stage.start_date,
                    stage.end_date,
                    stage.focus,
                    i64::from(stage.sort_order),
                    created_at,
                    stage.updated_at
                ],
            )
            .map_err(database_error)?;
        transaction.commit().map_err(database_error)?;
        load_stage(&connection, &stage.id)
    }

    fn delete_stage(
        &self,
        stage_id: &str,
        expected_plan_revision: u32,
        updated_at: i64,
    ) -> Result<(), PlanningError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let plan_id =
            parent_plan_id(&transaction, "plan_stage", stage_id).map_err(|error| match error {
                PlanningError::PlanNotFound => PlanningError::StageNotFound,
                other => other,
            })?;
        validate_and_bump_plan(&transaction, &plan_id, expected_plan_revision, updated_at)?;
        let changed = transaction
            .execute("DELETE FROM plan_stage WHERE id = ?1", params![stage_id])
            .map_err(database_error)?;
        if changed == 0 {
            return Err(PlanningError::StageNotFound);
        }
        transaction.commit().map_err(database_error)?;
        Ok(())
    }

    fn add_reference(
        &self,
        mut reference: PlanReference,
        expected_plan_revision: u32,
    ) -> Result<PlanReference, PlanningError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        validate_and_bump_plan(
            &transaction,
            &reference.plan_id,
            expected_plan_revision,
            reference.created_at,
        )?;
        let resource = transaction
            .query_row(
                "SELECT title, kind, page_count
                 FROM resource_document WHERE id = ?1",
                params![reference.document_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<i64>>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(database_error)?
            .ok_or(PlanningError::InvalidReference)?;
        if resource.1 != "pdf"
            || resource
                .2
                .is_some_and(|page_count| i64::from(reference.page_end) > page_count)
        {
            return Err(PlanningError::InvalidReference);
        }
        let existing_id = transaction
            .query_row(
                "SELECT id FROM plan_reference
                 WHERE plan_id = ?1 AND document_id = ?2
                   AND page_start = ?3 AND page_end = ?4",
                params![
                    reference.plan_id,
                    reference.document_id,
                    i64::from(reference.page_start),
                    i64::from(reference.page_end)
                ],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(database_error)?;
        if let Some(existing_id) = existing_id {
            reference.id = existing_id;
            transaction
                .execute(
                    "UPDATE plan_reference SET note = ?2 WHERE id = ?1",
                    params![reference.id, reference.note],
                )
                .map_err(database_error)?;
        } else {
            transaction
                .execute(
                    "INSERT INTO plan_reference(
                        id, plan_id, document_id, page_start, page_end, note, created_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        reference.id,
                        reference.plan_id,
                        reference.document_id,
                        i64::from(reference.page_start),
                        i64::from(reference.page_end),
                        reference.note,
                        reference.created_at
                    ],
                )
                .map_err(database_error)?;
        }
        transaction.commit().map_err(database_error)?;
        load_reference(&connection, &reference.id)
    }

    fn delete_reference(
        &self,
        reference_id: &str,
        expected_plan_revision: u32,
        updated_at: i64,
    ) -> Result<(), PlanningError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let plan_id =
            parent_plan_id(&transaction, "plan_reference", reference_id).map_err(|error| {
                match error {
                    PlanningError::PlanNotFound => PlanningError::ReferenceNotFound,
                    other => other,
                }
            })?;
        validate_and_bump_plan(&transaction, &plan_id, expected_plan_revision, updated_at)?;
        let changed = transaction
            .execute(
                "DELETE FROM plan_reference WHERE id = ?1",
                params![reference_id],
            )
            .map_err(database_error)?;
        if changed == 0 {
            return Err(PlanningError::ReferenceNotFound);
        }
        transaction.commit().map_err(database_error)?;
        Ok(())
    }
}

fn load_bundle(connection: &Connection, plan_id: &str) -> Result<StudyPlanBundle, PlanningError> {
    let plan = connection
        .query_row(
            "SELECT id, title, target_exam, exam_date, overview, status,
                    revision, created_at, updated_at
             FROM study_plan WHERE id = ?1",
            params![plan_id],
            map_plan_row,
        )
        .optional()
        .map_err(database_error)?
        .ok_or(PlanningError::PlanNotFound)?;
    load_bundle_for_plan(connection, plan)
}

fn load_bundle_for_plan(
    connection: &Connection,
    plan: StudyPlan,
) -> Result<StudyPlanBundle, PlanningError> {
    let mut stage_statement = connection
        .prepare(
            "SELECT id, plan_id, title, start_date, end_date, focus,
                    sort_order, created_at, updated_at
             FROM plan_stage WHERE plan_id = ?1
             ORDER BY sort_order, start_date, id",
        )
        .map_err(database_error)?;
    let stages = stage_statement
        .query_map(params![plan.id], map_stage_row)
        .map_err(database_error)?
        .map(|row| row.map_err(database_error))
        .collect::<Result<Vec<_>, _>>()?;
    let mut reference_statement = connection
        .prepare(
            "SELECT r.id, r.plan_id, r.document_id, d.title,
                    r.page_start, r.page_end, r.note, r.created_at
             FROM plan_reference r
             JOIN resource_document d ON d.id = r.document_id
             WHERE r.plan_id = ?1
             ORDER BY r.created_at, r.id",
        )
        .map_err(database_error)?;
    let references = reference_statement
        .query_map(params![plan.id], map_reference_row)
        .map_err(database_error)?
        .map(|row| row.map_err(database_error))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(StudyPlanBundle {
        plan,
        stages,
        references,
    })
}

fn load_stage(connection: &Connection, stage_id: &str) -> Result<PlanStage, PlanningError> {
    connection
        .query_row(
            "SELECT id, plan_id, title, start_date, end_date, focus,
                    sort_order, created_at, updated_at
             FROM plan_stage WHERE id = ?1",
            params![stage_id],
            map_stage_row,
        )
        .optional()
        .map_err(database_error)?
        .ok_or(PlanningError::StageNotFound)
}

fn load_reference(
    connection: &Connection,
    reference_id: &str,
) -> Result<PlanReference, PlanningError> {
    connection
        .query_row(
            "SELECT r.id, r.plan_id, r.document_id, d.title,
                    r.page_start, r.page_end, r.note, r.created_at
             FROM plan_reference r
             JOIN resource_document d ON d.id = r.document_id
             WHERE r.id = ?1",
            params![reference_id],
            map_reference_row,
        )
        .optional()
        .map_err(database_error)?
        .ok_or(PlanningError::ReferenceNotFound)
}

fn validate_and_bump_plan(
    transaction: &Transaction<'_>,
    plan_id: &str,
    expected_revision: u32,
    updated_at: i64,
) -> Result<(), PlanningError> {
    let changed = transaction
        .execute(
            "UPDATE study_plan
             SET revision = revision + 1, updated_at = ?3
             WHERE id = ?1 AND revision = ?2 AND status <> 'archived'",
            params![plan_id, i64::from(expected_revision), updated_at],
        )
        .map_err(database_error)?;
    if changed == 1 {
        return Ok(());
    }
    let exists = transaction
        .query_row(
            "SELECT 1 FROM study_plan WHERE id = ?1 AND status <> 'archived'",
            params![plan_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(database_error)?;
    match exists {
        Some(()) => Err(PlanningError::PlanSaveStale),
        None => Err(PlanningError::PlanNotFound),
    }
}

fn parent_plan_id(
    transaction: &Transaction<'_>,
    table: &str,
    child_id: &str,
) -> Result<String, PlanningError> {
    let sql = match table {
        "plan_stage" => "SELECT plan_id FROM plan_stage WHERE id = ?1",
        "plan_reference" => "SELECT plan_id FROM plan_reference WHERE id = ?1",
        _ => return Err(PlanningError::InvalidInput),
    };
    transaction
        .query_row(sql, params![child_id], |row| row.get(0))
        .optional()
        .map_err(database_error)?
        .ok_or(PlanningError::PlanNotFound)
}

fn map_plan_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StudyPlan> {
    let status = row.get::<_, String>(5)?;
    let status = PlanStatus::parse(&status).ok_or_else(|| conversion_error(5, "invalid status"))?;
    Ok(StudyPlan {
        id: row.get(0)?,
        title: row.get(1)?,
        target_exam: row.get(2)?,
        exam_date: row.get(3)?,
        overview: row.get(4)?,
        status,
        revision: to_u32(row.get::<_, i64>(6)?, 6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn map_stage_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PlanStage> {
    Ok(PlanStage {
        id: row.get(0)?,
        plan_id: row.get(1)?,
        title: row.get(2)?,
        start_date: row.get(3)?,
        end_date: row.get(4)?,
        focus: row.get(5)?,
        sort_order: to_u32(row.get::<_, i64>(6)?, 6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn map_reference_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PlanReference> {
    Ok(PlanReference {
        id: row.get(0)?,
        plan_id: row.get(1)?,
        document_id: row.get(2)?,
        document_title: row.get(3)?,
        page_start: to_u32(row.get::<_, i64>(4)?, 4)?,
        page_end: to_u32(row.get::<_, i64>(5)?, 5)?,
        note: row.get(6)?,
        created_at: row.get(7)?,
    })
}

fn load_workspace_id(connection: &Connection) -> Result<String, PlanningError> {
    connection
        .query_row(
            "SELECT id FROM workspace ORDER BY created_at LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(database_error)?
        .ok_or(PlanningError::WorkspaceNotInitialized)
}

fn to_u32(value: i64, index: usize) -> rusqlite::Result<u32> {
    u32::try_from(value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Integer,
            Box::new(error),
        )
    })
}

fn conversion_error(index: usize, message: &'static str) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        index,
        rusqlite::types::Type::Text,
        Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            message,
        )),
    )
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicBool;

    use tempfile::tempdir;

    use super::SqlitePlanningRepository;
    use crate::application::{
        AddPlanReferenceInput, PlanningError, PlanningUseCases, ResourceUseCases, SavePlanInput,
        SavePlanStageInput, WorkspaceRepository,
    };
    use crate::domain::NewWorkspace;
    use crate::infrastructure::{SqliteBlobStore, SqliteWorkspaceRepository};

    #[test]
    fn manual_plan_stage_and_pdf_reference_form_one_persisted_bundle() {
        let directory = tempdir().expect("temporary directory should exist");
        initialize_workspace(directory.path());
        let planning = PlanningUseCases::new(SqlitePlanningRepository::new(directory.path()));
        let resources = ResourceUseCases::new(SqliteBlobStore::new(directory.path()));
        let plan = planning
            .save_plan(SavePlanInput {
                id: None,
                expected_revision: None,
                title: "159 天备考计划".to_owned(),
                target_exam: Some("计算机考研".to_owned()),
                exam_date: Some("2026-12-25".to_owned()),
                overview: Some("先建立可执行的手动草案".to_owned()),
            })
            .expect("plan should save");
        planning
            .save_stage(SavePlanStageInput {
                id: None,
                plan_id: plan.plan.id.clone(),
                expected_plan_revision: plan.plan.revision,
                title: "基础阶段".to_owned(),
                start_date: "2026-07-19".to_owned(),
                end_date: "2026-09-01".to_owned(),
                focus: Some("数学与 408 基础".to_owned()),
                sort_order: 0,
            })
            .expect("stage should save");
        let source = directory.path().join("经验规划.pdf");
        std::fs::write(&source, b"%PDF-1.4\n%%EOF").expect("PDF fixture should write");
        let document = resources
            .import_file(&source, &AtomicBool::new(false), &mut |_| {})
            .expect("PDF should import");
        resources
            .save_reading_progress(&document.id, 12, 3)
            .expect("page count should save");
        planning
            .add_reference(AddPlanReferenceInput {
                plan_id: plan.plan.id.clone(),
                expected_plan_revision: plan.plan.revision + 1,
                document_id: document.id,
                page_start: 2,
                page_end: 3,
                note: Some("阶段划分依据".to_owned()),
            })
            .expect("reference should save");
        planning
            .set_status(&plan.plan.id, plan.plan.revision + 2, "active")
            .expect("plan should activate");

        let loaded = planning.list().expect("plans should load");

        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].plan.status.as_str(), "active");
        assert_eq!(loaded[0].stages.len(), 1);
        assert_eq!(loaded[0].references[0].page_start, 2);
        assert_eq!(loaded[0].references[0].document_title, "经验规划");
    }

    #[test]
    fn reference_cannot_exceed_a_known_pdf_page_count() {
        let directory = tempdir().expect("temporary directory should exist");
        initialize_workspace(directory.path());
        let planning = PlanningUseCases::new(SqlitePlanningRepository::new(directory.path()));
        let resources = ResourceUseCases::new(SqliteBlobStore::new(directory.path()));
        let plan = planning
            .save_plan(SavePlanInput {
                id: None,
                expected_revision: None,
                title: "引用边界".to_owned(),
                target_exam: None,
                exam_date: None,
                overview: None,
            })
            .expect("plan should save");
        let source = directory.path().join("边界.pdf");
        std::fs::write(&source, b"%PDF-1.4\n%%EOF").expect("PDF fixture should write");
        let document = resources
            .import_file(&source, &AtomicBool::new(false), &mut |_| {})
            .expect("PDF should import");
        resources
            .save_reading_progress(&document.id, 5, 1)
            .expect("page count should save");

        let result = planning.add_reference(AddPlanReferenceInput {
            plan_id: plan.plan.id,
            expected_plan_revision: plan.plan.revision,
            document_id: document.id,
            page_start: 5,
            page_end: 6,
            note: None,
        });

        assert!(result.is_err());
    }

    #[test]
    fn stale_plan_save_does_not_overwrite_the_latest_exam_information() {
        let directory = tempdir().expect("temporary directory should exist");
        initialize_workspace(directory.path());
        let planning = PlanningUseCases::new(SqlitePlanningRepository::new(directory.path()));
        let created = planning
            .save_plan(SavePlanInput {
                id: None,
                expected_revision: None,
                title: "考试计划".to_owned(),
                target_exam: Some("原考试".to_owned()),
                exam_date: Some("2026-12-20".to_owned()),
                overview: None,
            })
            .expect("plan should save");
        let plan_id = created.plan.id.clone();
        let original_revision = created.plan.revision;
        let saved = planning
            .save_plan(SavePlanInput {
                id: Some(plan_id.clone()),
                expected_revision: Some(original_revision),
                title: "考试计划".to_owned(),
                target_exam: Some("窗口 A 考试".to_owned()),
                exam_date: Some("2026-12-21".to_owned()),
                overview: None,
            })
            .expect("window A should save");

        let error = planning
            .save_plan(SavePlanInput {
                id: Some(plan_id.clone()),
                expected_revision: Some(original_revision),
                title: "考试计划".to_owned(),
                target_exam: Some("窗口 B 考试".to_owned()),
                exam_date: Some("2026-12-22".to_owned()),
                overview: None,
            })
            .expect_err("window B must not overwrite window A");

        assert!(matches!(error, PlanningError::PlanSaveStale));
        let loaded = planning.list().expect("plan should remain readable");
        assert_eq!(loaded[0].plan, saved.plan);
    }

    #[test]
    fn stale_status_change_does_not_demote_the_current_active_plan() {
        let directory = tempdir().expect("temporary directory should exist");
        initialize_workspace(directory.path());
        let planning = PlanningUseCases::new(SqlitePlanningRepository::new(directory.path()));
        let plan = planning
            .save_plan(SavePlanInput {
                id: None,
                expected_revision: None,
                title: "状态 CAS".to_owned(),
                target_exam: None,
                exam_date: None,
                overview: None,
            })
            .expect("plan should save");
        let stale_revision = plan.plan.revision;
        let active = planning
            .set_status(&plan.plan.id, stale_revision, "active")
            .expect("first window should activate the plan");

        let error = planning
            .set_status(&plan.plan.id, stale_revision, "archived")
            .expect_err("stale window must not archive the plan");

        assert!(matches!(error, PlanningError::PlanSaveStale));
        let loaded = planning.list().expect("plan should remain readable");
        assert_eq!(loaded[0].plan, active.plan);
    }

    #[test]
    fn stale_stage_delete_preserves_the_stage_and_parent_revision() {
        let directory = tempdir().expect("temporary directory should exist");
        initialize_workspace(directory.path());
        let planning = PlanningUseCases::new(SqlitePlanningRepository::new(directory.path()));
        let plan = planning
            .save_plan(SavePlanInput {
                id: None,
                expected_revision: None,
                title: "阶段 CAS".to_owned(),
                target_exam: None,
                exam_date: None,
                overview: None,
            })
            .expect("plan should save");
        let stage = planning
            .save_stage(SavePlanStageInput {
                id: None,
                plan_id: plan.plan.id.clone(),
                expected_plan_revision: plan.plan.revision,
                title: "基础阶段".to_owned(),
                start_date: "2026-08-13".to_owned(),
                end_date: "2026-09-01".to_owned(),
                focus: None,
                sort_order: 0,
            })
            .expect("stage should save");
        let before_delete = planning.list().expect("plan should load")[0].clone();

        let error = planning
            .delete_stage(&stage.id, plan.plan.revision)
            .expect_err("stale delete must not remove the stage");

        assert!(matches!(error, PlanningError::PlanSaveStale));
        let loaded = planning.list().expect("plan should remain readable");
        assert_eq!(loaded[0], before_delete);
    }

    #[test]
    fn archived_plan_rejects_a_new_reference_without_writing() {
        let directory = tempdir().expect("temporary directory should exist");
        initialize_workspace(directory.path());
        let planning = PlanningUseCases::new(SqlitePlanningRepository::new(directory.path()));
        let resources = ResourceUseCases::new(SqliteBlobStore::new(directory.path()));
        let plan = planning
            .save_plan(SavePlanInput {
                id: None,
                expected_revision: None,
                title: "归档引用".to_owned(),
                target_exam: None,
                exam_date: None,
                overview: None,
            })
            .expect("plan should save");
        let source = directory.path().join("归档引用.pdf");
        std::fs::write(&source, b"%PDF-1.4\n%%EOF").expect("PDF fixture should write");
        let document = resources
            .import_file(&source, &AtomicBool::new(false), &mut |_| {})
            .expect("PDF should import");
        let archived = planning
            .set_status(&plan.plan.id, plan.plan.revision, "archived")
            .expect("plan should archive");

        let error = planning
            .add_reference(AddPlanReferenceInput {
                plan_id: archived.plan.id.clone(),
                expected_plan_revision: archived.plan.revision,
                document_id: document.id,
                page_start: 1,
                page_end: 1,
                note: None,
            })
            .expect_err("archived plan must reject new references");

        assert!(matches!(error, PlanningError::PlanNotFound));
        let loaded = planning.list().expect("plan should remain readable");
        assert!(loaded[0].references.is_empty());
        assert_eq!(loaded[0].plan, archived.plan);
    }

    fn initialize_workspace(directory: &std::path::Path) {
        SqliteWorkspaceRepository::new(directory)
            .initialize_default(&NewWorkspace::default_at(1_700_000_000_000))
            .expect("workspace should initialize");
    }
}
