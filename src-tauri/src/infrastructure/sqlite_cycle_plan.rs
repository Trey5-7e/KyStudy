use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use uuid::Uuid;

use crate::application::{
    ConfirmedShiftMutation, CyclePlanError, CyclePlanRepository, GeneratedCyclePlanItem,
    SHIFT_UNDO_WINDOW_MS, ShiftCyclePlanPreview, ShiftCyclePlanUndo, ShiftProjection,
    ShiftedCyclePlanItem, ValidatedShiftCyclePlanIntent, build_shift_projection,
    next_monotonic_updated_at,
};
use crate::domain::{CyclePlan, CyclePlanItem, CyclePlanItemState, CycleScheduleMode, LocalDate};

use super::sqlite_workspace::{SqliteWorkspaceRepository, database_error, migrate, open_database};

#[derive(Debug, Clone)]
pub(crate) struct SqliteCyclePlanRepository {
    database_path: PathBuf,
}

impl SqliteCyclePlanRepository {
    pub(crate) fn new(application_data_directory: &Path) -> Self {
        let workspace = SqliteWorkspaceRepository::new(application_data_directory);
        Self {
            database_path: workspace.database_path(),
        }
    }

    fn open(&self) -> Result<Connection, CyclePlanError> {
        if !self.database_path.exists() {
            return Err(CyclePlanError::WorkspaceNotInitialized);
        }
        let mut connection = open_database(&self.database_path, false)?;
        migrate(&mut connection)?;
        Ok(connection)
    }
}

impl CyclePlanRepository for SqliteCyclePlanRepository {
    fn rest_weekdays(&self) -> Result<Vec<u8>, CyclePlanError> {
        let connection = self.open()?;
        let workspace_id = workspace_id(&connection)?;
        load_rest_weekdays(&connection, &workspace_id)
    }

    fn load_plans(&self) -> Result<Vec<(CyclePlan, Vec<CyclePlanItem>)>, CyclePlanError> {
        let connection = self.open()?;
        let workspace_id = workspace_id(&connection)?;
        let plans = load_plans(&connection, &workspace_id)?;
        plans
            .into_iter()
            .map(|plan| {
                let items = load_items(&connection, &plan.id)?;
                Ok((plan, items))
            })
            .collect()
    }

    fn save_plan(
        &self,
        plan: &CyclePlan,
        generated: &[GeneratedCyclePlanItem],
        expected_updated_at: Option<i64>,
    ) -> Result<(), CyclePlanError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let workspace_id = workspace_id(&transaction)?;
        let target =
            validate_plan_save_target(&transaction, &plan.id, &workspace_id, expected_updated_at)?;
        let aggregate_updated_at = next_plan_revision(
            &transaction,
            &plan.id,
            plan.updated_at,
            target.as_ref().map(|value| value.updated_at),
        )?;
        invalidate_shift_undo_for_plan(&transaction, &plan.id)?;
        ensure_terminal_items_within_total(&transaction, &plan.id, plan.total_units)?;
        let changed = transaction
            .execute(
                "INSERT INTO cycle_plan(
                    id, workspace_id, name, total_units, unit_label, start_date,
                    deadline, study_days_per_unit, schedule_mode, calendar_visible,
                    archived_at, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11, ?12)
                 ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    total_units = excluded.total_units,
                    unit_label = excluded.unit_label,
                    start_date = excluded.start_date,
                    deadline = excluded.deadline,
                    study_days_per_unit = excluded.study_days_per_unit,
                    schedule_mode = excluded.schedule_mode,
                    calendar_visible = excluded.calendar_visible,
                    updated_at = excluded.updated_at
                 WHERE cycle_plan.workspace_id = excluded.workspace_id
                   AND cycle_plan.archived_at IS NULL",
                params![
                    plan.id,
                    workspace_id,
                    plan.name,
                    i64::from(plan.total_units),
                    plan.unit_label,
                    plan.start_date.as_str(),
                    plan.deadline.as_str(),
                    i64::from(plan.study_days_per_unit),
                    plan.schedule_mode.as_str(),
                    plan.calendar_visible,
                    target
                        .as_ref()
                        .map_or(plan.created_at, |value| value.created_at),
                    aggregate_updated_at,
                ],
            )
            .map_err(database_error)?;
        if changed != 1 {
            return Err(CyclePlanError::PlanNotFound);
        }
        transaction
            .execute(
                "DELETE FROM cycle_plan_item
                 WHERE plan_id = ?1 AND state = 'pending' AND unit_index > ?2",
                params![plan.id, i64::from(plan.total_units)],
            )
            .map_err(database_error)?;
        for item in generated {
            transaction
                .execute(
                    "INSERT INTO cycle_plan_item(
                        id, plan_id, unit_index, planned_start_date, planned_end_date,
                        original_start_date, original_end_date, state, completed_at, skipped_at,
                        shift_count, created_at, updated_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?4, ?5, 'pending', NULL, NULL, 0, ?6, ?6)
                     ON CONFLICT(plan_id, unit_index) DO UPDATE SET
                        planned_start_date = excluded.planned_start_date,
                        planned_end_date = excluded.planned_end_date,
                        original_start_date = excluded.original_start_date,
                        original_end_date = excluded.original_end_date,
                        shift_count = 0,
                        updated_at = excluded.updated_at
                     WHERE cycle_plan_item.state = 'pending'",
                    params![
                        item.id,
                        plan.id,
                        i64::from(item.unit_index),
                        item.start_date.as_str(),
                        item.end_date.as_str(),
                        aggregate_updated_at,
                    ],
                )
                .map_err(database_error)?;
        }
        transaction.commit().map_err(database_error)?;
        Ok(())
    }

    fn preview_shift(
        &self,
        intent: &ValidatedShiftCyclePlanIntent,
    ) -> Result<ShiftCyclePlanPreview, CyclePlanError> {
        let mut connection = self.open()?;
        let transaction = connection.transaction().map_err(database_error)?;
        let projection = load_shift_projection(&transaction, intent)?;
        let preview = projection.preview;
        transaction.commit().map_err(database_error)?;
        Ok(preview)
    }

    fn confirm_shift(
        &self,
        intent: &ValidatedShiftCyclePlanIntent,
        preview_token: &str,
        now: i64,
    ) -> Result<ConfirmedShiftMutation, CyclePlanError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let projection = load_shift_projection(&transaction, intent)?;
        if projection.preview.preview_token.as_deref() != Some(preview_token) {
            return Err(CyclePlanError::ShiftPreviewStale);
        }
        let mutation = apply_confirmed_shift(&transaction, intent, &projection, now)?;
        transaction.commit().map_err(database_error)?;
        Ok(mutation)
    }

    fn undo_shifted_items(
        &self,
        plan_id: &str,
        undo_token: &str,
        now: i64,
    ) -> Result<(), CyclePlanError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let Some(header) = load_shift_undo_header(&transaction, plan_id, undo_token)? else {
            return Err(CyclePlanError::ShiftUndoUnavailable);
        };
        if header.expires_at <= now {
            return Err(CyclePlanError::ShiftUndoUnavailable);
        }
        let snapshots = load_shift_undo_snapshots(&transaction, undo_token)?;
        let expected_count =
            usize::try_from(header.shifted_item_count).map_err(|_| CyclePlanError::InvalidInput)?;
        if snapshots.len() != expected_count {
            return Err(CyclePlanError::ShiftUndoStale);
        }
        restore_shift_undo_items(&transaction, plan_id, &snapshots, now)?;
        bump_plan_revision(&transaction, plan_id, now)?;
        consume_shift_undo(&transaction, plan_id, undo_token)?;
        transaction.commit().map_err(database_error)?;
        Ok(())
    }

    fn transition_item_state(
        &self,
        item_id: &str,
        target_state: CyclePlanItemState,
        completed_at: Option<i64>,
        skipped_at: Option<i64>,
        expected_updated_at: i64,
        updated_at: i64,
    ) -> Result<(), CyclePlanError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        update_item_state(
            &transaction,
            item_id,
            target_state,
            completed_at,
            skipped_at,
            expected_updated_at,
            updated_at,
        )?;
        let plan_id = plan_id_for_item(&transaction, item_id)?;
        bump_plan_revision(&transaction, &plan_id, updated_at)?;
        invalidate_shift_undo_for_item(&transaction, item_id)?;
        transaction.commit().map_err(database_error)?;
        Ok(())
    }

    fn restore_item_state(
        &self,
        item_id: &str,
        original_state: CyclePlanItemState,
        original_completed_at: Option<i64>,
        original_skipped_at: Option<i64>,
        expected_updated_at: i64,
        updated_at: i64,
    ) -> Result<(), CyclePlanError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        update_item_state(
            &transaction,
            item_id,
            original_state,
            original_completed_at,
            original_skipped_at,
            expected_updated_at,
            updated_at,
        )?;
        let plan_id = plan_id_for_item(&transaction, item_id)?;
        bump_plan_revision(&transaction, &plan_id, updated_at)?;
        invalidate_shift_undo_for_item(&transaction, item_id)?;
        transaction.commit().map_err(database_error)?;
        Ok(())
    }

    fn archive_plan(
        &self,
        plan_id: &str,
        expected_updated_at: i64,
        archived_at: i64,
    ) -> Result<(), CyclePlanError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let changed = transaction
            .execute(
                "UPDATE cycle_plan SET archived_at = ?2
                 WHERE id = ?1 AND archived_at IS NULL AND updated_at = ?3",
                params![plan_id, archived_at, expected_updated_at],
            )
            .map_err(database_error)?;
        if changed != 1 {
            return classify_plan_save_conflict(&transaction, plan_id);
        }
        transaction
            .execute(
                "DELETE FROM cycle_plan_shift_undo WHERE plan_id = ?1",
                params![plan_id],
            )
            .map_err(database_error)?;
        transaction.commit().map_err(database_error)?;
        Ok(())
    }
}

fn load_shift_projection(
    transaction: &Transaction<'_>,
    intent: &ValidatedShiftCyclePlanIntent,
) -> Result<ShiftProjection, CyclePlanError> {
    let workspace_id = workspace_id(transaction)?;
    let plan = load_active_plan_for_workspace(transaction, &intent.plan_id, &workspace_id)?
        .ok_or(CyclePlanError::PlanNotFound)?;
    let rest_weekdays = load_rest_weekdays(transaction, &workspace_id)?;
    let items = load_items(transaction, &intent.plan_id)?;
    build_shift_projection(&workspace_id, &plan, &items, &rest_weekdays, intent)
}

fn apply_confirmed_shift(
    transaction: &Transaction<'_>,
    intent: &ValidatedShiftCyclePlanIntent,
    projection: &ShiftProjection,
    now: i64,
) -> Result<ConfirmedShiftMutation, CyclePlanError> {
    transaction
        .execute(
            "DELETE FROM cycle_plan_shift_undo WHERE plan_id = ?1",
            params![intent.plan_id],
        )
        .map_err(database_error)?;
    let shifted_item_count =
        u32::try_from(projection.shifted_items.len()).map_err(|_| CyclePlanError::InvalidInput)?;
    let updated_at = next_monotonic_updated_at(now, &projection.shifted_items)?;
    let expires_at = now
        .checked_add(SHIFT_UNDO_WINDOW_MS)
        .ok_or(CyclePlanError::InvalidInput)?;
    let undo_token = Uuid::now_v7().to_string();
    insert_shift_undo_header(
        transaction,
        &ShiftUndoMetadata {
            undo_token: &undo_token,
            plan_id: &intent.plan_id,
            shifted_item_count,
            created_at: now,
            expires_at,
        },
    )?;
    for shifted in &projection.shifted_items {
        shift_one_item(
            transaction,
            &intent.plan_id,
            shifted,
            updated_at,
            &undo_token,
        )?;
    }
    bump_plan_revision(transaction, &intent.plan_id, updated_at)?;
    Ok(ConfirmedShiftMutation {
        shifted_item_count,
        undo: Some(ShiftCyclePlanUndo {
            plan_id: intent.plan_id.clone(),
            undo_token,
            expires_at,
        }),
    })
}

fn load_rest_weekdays(
    connection: &Connection,
    workspace_id: &str,
) -> Result<Vec<u8>, CyclePlanError> {
    let mut statement = connection
        .prepare(
            "SELECT weekday FROM workspace_rest_weekday
             WHERE workspace_id = ?1 ORDER BY weekday",
        )
        .map_err(database_error)?;
    statement
        .query_map(params![workspace_id], |row| row.get::<_, u8>(0))
        .map_err(database_error)?
        .map(|row| row.map_err(database_error).map_err(Into::into))
        .collect()
}

#[derive(Debug)]
struct ShiftUndoMetadata<'a> {
    undo_token: &'a str,
    plan_id: &'a str,
    shifted_item_count: u32,
    created_at: i64,
    expires_at: i64,
}

#[derive(Debug)]
struct CurrentShiftItem {
    before_planned_start_date: String,
    before_planned_end_date: String,
    before_shift_count: i64,
    before_updated_at: i64,
    state: String,
}

#[derive(Debug)]
struct ShiftUndoHeader {
    shifted_item_count: u32,
    expires_at: i64,
}

#[derive(Debug)]
struct ShiftUndoSnapshot {
    item_id: String,
    before_planned_start_date: String,
    before_planned_end_date: String,
    before_shift_count: i64,
    before_updated_at: i64,
    shifted_planned_start_date: String,
    shifted_planned_end_date: String,
    shifted_shift_count: i64,
    shifted_updated_at: i64,
}

#[derive(Debug)]
struct ExistingPlanRevision {
    created_at: i64,
    updated_at: i64,
}

fn validate_plan_save_target(
    transaction: &Transaction<'_>,
    plan_id: &str,
    workspace_id: &str,
    expected_updated_at: Option<i64>,
) -> Result<Option<ExistingPlanRevision>, CyclePlanError> {
    let existing = transaction
        .query_row(
            "SELECT workspace_id, archived_at, created_at, updated_at
             FROM cycle_plan WHERE id = ?1",
            params![plan_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<i64>>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .optional()
        .map_err(database_error)?;
    match existing {
        None if expected_updated_at.is_none() => Ok(None),
        Some((owner_id, archived_at, _, _))
            if owner_id != workspace_id || archived_at.is_some() =>
        {
            Err(CyclePlanError::PlanNotFound)
        }
        Some((_, _, created_at, updated_at)) if expected_updated_at == Some(updated_at) => {
            Ok(Some(ExistingPlanRevision {
                created_at,
                updated_at,
            }))
        }
        None => Err(CyclePlanError::PlanNotFound),
        Some(_) => Err(CyclePlanError::SaveStale),
    }
}

fn classify_plan_save_conflict(
    transaction: &Transaction<'_>,
    plan_id: &str,
) -> Result<(), CyclePlanError> {
    let active = transaction
        .query_row(
            "SELECT 1 FROM cycle_plan WHERE id = ?1 AND archived_at IS NULL",
            params![plan_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(database_error)?;
    match active {
        Some(()) => Err(CyclePlanError::SaveStale),
        None => Err(CyclePlanError::PlanNotFound),
    }
}

fn invalidate_shift_undo_for_plan(
    transaction: &Transaction<'_>,
    plan_id: &str,
) -> Result<(), CyclePlanError> {
    transaction
        .execute(
            "DELETE FROM cycle_plan_shift_undo WHERE plan_id = ?1",
            params![plan_id],
        )
        .map_err(database_error)?;
    Ok(())
}

fn ensure_terminal_items_within_total(
    transaction: &Transaction<'_>,
    plan_id: &str,
    total_units: u32,
) -> Result<(), CyclePlanError> {
    let highest_terminal_unit_index = transaction
        .query_row(
            "SELECT COALESCE(MAX(unit_index), 0) FROM cycle_plan_item
             WHERE plan_id = ?1 AND state IN ('completed', 'skipped')",
            params![plan_id],
            |row| row.get::<_, u32>(0),
        )
        .map_err(database_error)?;
    if highest_terminal_unit_index > total_units {
        return Err(CyclePlanError::CompletedProgressConflict);
    }
    Ok(())
}

fn next_plan_revision(
    transaction: &Transaction<'_>,
    plan_id: &str,
    candidate: i64,
    current_revision: Option<i64>,
) -> Result<i64, CyclePlanError> {
    let maximum_item_revision = transaction
        .query_row(
            "SELECT MAX(updated_at) FROM cycle_plan_item WHERE plan_id = ?1",
            params![plan_id],
            |row| row.get::<_, Option<i64>>(0),
        )
        .map_err(database_error)?;
    [current_revision, maximum_item_revision]
        .into_iter()
        .flatten()
        .try_fold(candidate, |revision, value| {
            value
                .checked_add(1)
                .map(|minimum| revision.max(minimum))
                .ok_or(CyclePlanError::InvalidInput)
        })
}

fn bump_plan_revision(
    transaction: &Transaction<'_>,
    plan_id: &str,
    candidate: i64,
) -> Result<i64, CyclePlanError> {
    let current_revision = transaction
        .query_row(
            "SELECT updated_at FROM cycle_plan
             WHERE id = ?1 AND archived_at IS NULL",
            params![plan_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(database_error)?
        .ok_or(CyclePlanError::PlanNotFound)?;
    let next_revision =
        next_plan_revision(transaction, plan_id, candidate, Some(current_revision))?;
    let changed = transaction
        .execute(
            "UPDATE cycle_plan SET updated_at = ?2
             WHERE id = ?1 AND archived_at IS NULL AND updated_at = ?3",
            params![plan_id, next_revision, current_revision],
        )
        .map_err(database_error)?;
    if changed != 1 {
        return Err(CyclePlanError::SaveStale);
    }
    Ok(next_revision)
}

fn plan_id_for_item(
    transaction: &Transaction<'_>,
    item_id: &str,
) -> Result<String, CyclePlanError> {
    transaction
        .query_row(
            "SELECT plan_id FROM cycle_plan_item WHERE id = ?1",
            params![item_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(database_error)?
        .ok_or(CyclePlanError::ItemNotFound)
}

fn insert_shift_undo_header(
    transaction: &Transaction<'_>,
    metadata: &ShiftUndoMetadata<'_>,
) -> Result<(), CyclePlanError> {
    transaction
        .execute(
            "INSERT INTO cycle_plan_shift_undo(
                undo_token, plan_id, shifted_item_count, created_at, expires_at
             ) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                metadata.undo_token,
                metadata.plan_id,
                i64::from(metadata.shifted_item_count),
                metadata.created_at,
                metadata.expires_at,
            ],
        )
        .map_err(database_error)?;
    Ok(())
}

fn shift_one_item(
    transaction: &Transaction<'_>,
    plan_id: &str,
    shifted: &ShiftedCyclePlanItem,
    updated_at: i64,
    undo_token: &str,
) -> Result<(), CyclePlanError> {
    if shifted.before.plan_id != plan_id || shifted.after.plan_id != plan_id {
        return Err(CyclePlanError::InvalidInput);
    }
    let current = load_current_shift_item(transaction, &shifted.after.id, plan_id)?;
    let Some(current) = current else {
        return Err(CyclePlanError::ItemNotFound);
    };
    if current.state != "pending"
        || current.before_planned_start_date != shifted.before.planned_start_date.as_str()
        || current.before_planned_end_date != shifted.before.planned_end_date.as_str()
        || current.before_shift_count != i64::from(shifted.before.shift_count)
        || current.before_updated_at != shifted.before.updated_at
        || updated_at <= current.before_updated_at
    {
        return Err(CyclePlanError::ItemStateStale);
    }
    let changed = transaction
        .execute(
            "UPDATE cycle_plan_item
             SET planned_start_date = ?2, planned_end_date = ?3,
                 shift_count = ?4, updated_at = ?5
             WHERE id = ?1 AND plan_id = ?6 AND state = 'pending'
               AND planned_start_date = ?7 AND planned_end_date = ?8
               AND shift_count = ?9 AND updated_at = ?10",
            params![
                shifted.after.id,
                shifted.after.planned_start_date.as_str(),
                shifted.after.planned_end_date.as_str(),
                i64::from(shifted.after.shift_count),
                updated_at,
                plan_id,
                shifted.before.planned_start_date.as_str(),
                shifted.before.planned_end_date.as_str(),
                i64::from(shifted.before.shift_count),
                shifted.before.updated_at,
            ],
        )
        .map_err(database_error)?;
    if changed != 1 {
        return Err(CyclePlanError::ItemStateStale);
    }
    insert_shift_undo_item(transaction, undo_token, shifted, &current, updated_at)
}

fn load_current_shift_item(
    transaction: &Transaction<'_>,
    item_id: &str,
    plan_id: &str,
) -> Result<Option<CurrentShiftItem>, CyclePlanError> {
    Ok(transaction
        .query_row(
            "SELECT planned_start_date, planned_end_date, shift_count,
                    updated_at, state
             FROM cycle_plan_item
             WHERE id = ?1 AND plan_id = ?2",
            params![item_id, plan_id],
            |row| {
                Ok(CurrentShiftItem {
                    before_planned_start_date: row.get(0)?,
                    before_planned_end_date: row.get(1)?,
                    before_shift_count: row.get(2)?,
                    before_updated_at: row.get(3)?,
                    state: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(database_error)?)
}

fn insert_shift_undo_item(
    transaction: &Transaction<'_>,
    undo_token: &str,
    shifted: &ShiftedCyclePlanItem,
    current: &CurrentShiftItem,
    updated_at: i64,
) -> Result<(), CyclePlanError> {
    transaction
        .execute(
            "INSERT INTO cycle_plan_shift_undo_item(
                undo_token, item_id,
                before_planned_start_date, before_planned_end_date,
                before_shift_count, before_updated_at,
                shifted_planned_start_date, shifted_planned_end_date,
                shifted_shift_count, shifted_updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                undo_token,
                shifted.after.id,
                current.before_planned_start_date,
                current.before_planned_end_date,
                current.before_shift_count,
                current.before_updated_at,
                shifted.after.planned_start_date.as_str(),
                shifted.after.planned_end_date.as_str(),
                i64::from(shifted.after.shift_count),
                updated_at,
            ],
        )
        .map_err(database_error)?;
    Ok(())
}

fn load_shift_undo_header(
    transaction: &Transaction<'_>,
    plan_id: &str,
    undo_token: &str,
) -> Result<Option<ShiftUndoHeader>, CyclePlanError> {
    Ok(transaction
        .query_row(
            "SELECT undo.shifted_item_count, undo.expires_at
             FROM cycle_plan_shift_undo AS undo
             JOIN cycle_plan AS plan ON plan.id = undo.plan_id
             WHERE undo.undo_token = ?1 AND undo.plan_id = ?2
               AND plan.archived_at IS NULL",
            params![undo_token, plan_id],
            |row| {
                Ok(ShiftUndoHeader {
                    shifted_item_count: row.get(0)?,
                    expires_at: row.get(1)?,
                })
            },
        )
        .optional()
        .map_err(database_error)?)
}

fn load_shift_undo_snapshots(
    transaction: &Transaction<'_>,
    undo_token: &str,
) -> Result<Vec<ShiftUndoSnapshot>, CyclePlanError> {
    let mut statement = transaction
        .prepare(
            "SELECT item_id,
                    before_planned_start_date, before_planned_end_date,
                    before_shift_count, before_updated_at,
                    shifted_planned_start_date, shifted_planned_end_date,
                    shifted_shift_count, shifted_updated_at
             FROM cycle_plan_shift_undo_item
             WHERE undo_token = ?1 ORDER BY item_id",
        )
        .map_err(database_error)?;
    Ok(statement
        .query_map(params![undo_token], |row| {
            Ok(ShiftUndoSnapshot {
                item_id: row.get(0)?,
                before_planned_start_date: row.get(1)?,
                before_planned_end_date: row.get(2)?,
                before_shift_count: row.get(3)?,
                before_updated_at: row.get(4)?,
                shifted_planned_start_date: row.get(5)?,
                shifted_planned_end_date: row.get(6)?,
                shifted_shift_count: row.get(7)?,
                shifted_updated_at: row.get(8)?,
            })
        })
        .map_err(database_error)?
        .map(|row| row.map_err(database_error))
        .collect::<Result<Vec<_>, _>>()?)
}

fn restore_shift_undo_items(
    transaction: &Transaction<'_>,
    plan_id: &str,
    snapshots: &[ShiftUndoSnapshot],
    now: i64,
) -> Result<(), CyclePlanError> {
    let mut updated_at = now;
    for snapshot in snapshots {
        updated_at = updated_at.max(
            snapshot
                .shifted_updated_at
                .checked_add(1)
                .ok_or(CyclePlanError::InvalidInput)?,
        );
        updated_at = updated_at.max(
            snapshot
                .before_updated_at
                .checked_add(1)
                .ok_or(CyclePlanError::InvalidInput)?,
        );
        restore_shift_undo_item(transaction, plan_id, snapshot, updated_at)?;
        updated_at = updated_at
            .checked_add(1)
            .ok_or(CyclePlanError::InvalidInput)?;
    }
    Ok(())
}

fn restore_shift_undo_item(
    transaction: &Transaction<'_>,
    plan_id: &str,
    snapshot: &ShiftUndoSnapshot,
    updated_at: i64,
) -> Result<(), CyclePlanError> {
    let changed = transaction
        .execute(
            "UPDATE cycle_plan_item
             SET planned_start_date = ?2, planned_end_date = ?3,
                 shift_count = ?4, updated_at = ?5
             WHERE id = ?1 AND plan_id = ?6 AND state = 'pending'
               AND planned_start_date = ?7 AND planned_end_date = ?8
               AND shift_count = ?9 AND updated_at = ?10",
            params![
                snapshot.item_id,
                snapshot.before_planned_start_date,
                snapshot.before_planned_end_date,
                snapshot.before_shift_count,
                updated_at,
                plan_id,
                snapshot.shifted_planned_start_date,
                snapshot.shifted_planned_end_date,
                snapshot.shifted_shift_count,
                snapshot.shifted_updated_at,
            ],
        )
        .map_err(database_error)?;
    if changed != 1 {
        return Err(CyclePlanError::ShiftUndoStale);
    }
    Ok(())
}

fn consume_shift_undo(
    transaction: &Transaction<'_>,
    plan_id: &str,
    undo_token: &str,
) -> Result<(), CyclePlanError> {
    let deleted = transaction
        .execute(
            "DELETE FROM cycle_plan_shift_undo
             WHERE undo_token = ?1 AND plan_id = ?2",
            params![undo_token, plan_id],
        )
        .map_err(database_error)?;
    if deleted != 1 {
        return Err(CyclePlanError::ShiftUndoUnavailable);
    }
    Ok(())
}

fn invalidate_shift_undo_for_item(
    transaction: &Transaction<'_>,
    item_id: &str,
) -> Result<(), CyclePlanError> {
    transaction
        .execute(
            "DELETE FROM cycle_plan_shift_undo
             WHERE plan_id = (SELECT plan_id FROM cycle_plan_item WHERE id = ?1)",
            params![item_id],
        )
        .map_err(database_error)?;
    Ok(())
}

fn update_item_state(
    transaction: &Transaction<'_>,
    item_id: &str,
    target_state: CyclePlanItemState,
    completed_at: Option<i64>,
    skipped_at: Option<i64>,
    expected_updated_at: i64,
    updated_at: i64,
) -> Result<(), CyclePlanError> {
    let current = transaction
        .query_row(
            "SELECT state, updated_at FROM cycle_plan_item WHERE id = ?1",
            params![item_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()
        .map_err(database_error)?
        .ok_or(CyclePlanError::ItemNotFound)?;
    if current.1 != expected_updated_at {
        return Err(CyclePlanError::ItemStateStale);
    }
    let current_state =
        CyclePlanItemState::parse(&current.0).ok_or(CyclePlanError::InvalidInput)?;
    if current_state == target_state
        || (current_state != CyclePlanItemState::Pending
            && target_state != CyclePlanItemState::Pending)
        || !valid_transition_timestamps(target_state, completed_at, skipped_at)
    {
        return Err(CyclePlanError::InvalidInput);
    }
    let changed = transaction
        .execute(
            "UPDATE cycle_plan_item
             SET state = ?2, completed_at = ?3, skipped_at = ?4, updated_at = ?5
             WHERE id = ?1 AND state = ?6 AND updated_at = ?7",
            params![
                item_id,
                target_state.as_str(),
                completed_at,
                skipped_at,
                updated_at,
                current_state.as_str(),
                expected_updated_at,
            ],
        )
        .map_err(database_error)?;
    if changed == 1 {
        return Ok(());
    }
    Err(CyclePlanError::ItemStateStale)
}

fn valid_transition_timestamps(
    state: CyclePlanItemState,
    completed_at: Option<i64>,
    skipped_at: Option<i64>,
) -> bool {
    match state {
        CyclePlanItemState::Pending => completed_at.is_none() && skipped_at.is_none(),
        CyclePlanItemState::Completed => completed_at.is_some() && skipped_at.is_none(),
        CyclePlanItemState::Skipped => completed_at.is_none() && skipped_at.is_some(),
    }
}

fn workspace_id(connection: &Connection) -> Result<String, CyclePlanError> {
    connection
        .query_row(
            "SELECT id FROM workspace WHERE singleton_key = 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(database_error)?
        .ok_or(CyclePlanError::WorkspaceNotInitialized)
}

fn load_plans(
    connection: &Connection,
    workspace_id: &str,
) -> Result<Vec<CyclePlan>, CyclePlanError> {
    let mut statement = connection
        .prepare(
            "SELECT id, name, total_units, unit_label, start_date, deadline,
                    study_days_per_unit, schedule_mode, calendar_visible,
                    created_at, updated_at
             FROM cycle_plan
             WHERE workspace_id = ?1 AND archived_at IS NULL
             ORDER BY created_at, id",
        )
        .map_err(database_error)?;
    statement
        .query_map(params![workspace_id], cycle_plan_from_row)
        .map_err(database_error)?
        .map(|row| row.map_err(database_error).map_err(Into::into))
        .collect()
}

fn load_active_plan_for_workspace(
    connection: &Connection,
    plan_id: &str,
    workspace_id: &str,
) -> Result<Option<CyclePlan>, CyclePlanError> {
    connection
        .query_row(
            "SELECT id, name, total_units, unit_label, start_date, deadline,
                    study_days_per_unit, schedule_mode, calendar_visible,
                    created_at, updated_at
             FROM cycle_plan
             WHERE id = ?1 AND workspace_id = ?2 AND archived_at IS NULL",
            params![plan_id, workspace_id],
            cycle_plan_from_row,
        )
        .optional()
        .map_err(database_error)
        .map_err(Into::into)
}

fn cycle_plan_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CyclePlan> {
    let mode = row.get::<_, String>(7)?;
    Ok(CyclePlan {
        id: row.get(0)?,
        name: row.get(1)?,
        total_units: to_u32(row.get(2)?, 2)?,
        unit_label: row.get(3)?,
        start_date: parse_date(&row.get::<_, String>(4)?, 4)?,
        deadline: parse_date(&row.get::<_, String>(5)?, 5)?,
        study_days_per_unit: to_u32(row.get(6)?, 6)?,
        schedule_mode: CycleScheduleMode::parse(&mode)
            .ok_or_else(|| conversion_error(7, "invalid schedule mode"))?,
        calendar_visible: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn load_items(
    connection: &Connection,
    plan_id: &str,
) -> Result<Vec<CyclePlanItem>, CyclePlanError> {
    let mut statement = connection
        .prepare(
            "SELECT id, unit_index, planned_start_date, planned_end_date,
                    original_start_date, original_end_date, state, completed_at, skipped_at,
                    shift_count, created_at, updated_at
             FROM cycle_plan_item WHERE plan_id = ?1 ORDER BY unit_index",
        )
        .map_err(database_error)?;
    statement
        .query_map(params![plan_id], |row| {
            let state = row.get::<_, String>(6)?;
            Ok(CyclePlanItem {
                id: row.get(0)?,
                plan_id: plan_id.to_owned(),
                unit_index: to_u32(row.get(1)?, 1)?,
                planned_start_date: parse_date(&row.get::<_, String>(2)?, 2)?,
                planned_end_date: parse_date(&row.get::<_, String>(3)?, 3)?,
                original_start_date: parse_date(&row.get::<_, String>(4)?, 4)?,
                original_end_date: parse_date(&row.get::<_, String>(5)?, 5)?,
                state: CyclePlanItemState::parse(&state)
                    .ok_or_else(|| conversion_error(6, "invalid item state"))?,
                completed_at: row.get(7)?,
                skipped_at: row.get(8)?,
                shift_count: to_u32(row.get(9)?, 9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })
        .map_err(database_error)?
        .map(|row| row.map_err(database_error).map_err(Into::into))
        .collect()
}

fn parse_date(value: &str, index: usize) -> rusqlite::Result<LocalDate> {
    LocalDate::parse(value).map_err(|_| conversion_error(index, "invalid local date"))
}

fn to_u32(value: i64, index: usize) -> rusqlite::Result<u32> {
    u32::try_from(value).map_err(|_| conversion_error(index, "integer is outside u32"))
}

fn conversion_error(index: usize, message: &'static str) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        index,
        rusqlite::types::Type::Integer,
        Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            message,
        )),
    )
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use rusqlite::params;
    use tempfile::tempdir;

    use super::{SqliteCyclePlanRepository, load_items, workspace_id};
    use crate::application::{
        ConfirmShiftCyclePlanInput, CyclePlanError, CyclePlanRepository, CyclePlanUseCases,
        GeneratedCyclePlanItem, RestoreCyclePlanItemStateInput, ReviewSchemeUseCases,
        SaveCyclePlanInput, SetCyclePlanItemStateInput, ShiftCyclePlanInput, ShiftCyclePlanResult,
        UndoShiftCyclePlanInput, WorkspaceRepository,
    };
    use crate::domain::{CyclePlanItemState, NewWorkspace};
    use crate::infrastructure::{SqliteReviewSchemeRepository, SqliteWorkspaceRepository};

    fn use_cases(directory: &Path) -> CyclePlanUseCases<SqliteCyclePlanRepository> {
        SqliteWorkspaceRepository::new(directory)
            .initialize_default(&NewWorkspace::default_at(1_700_000_000_000))
            .expect("workspace should initialize");
        ReviewSchemeUseCases::new(SqliteReviewSchemeRepository::new(directory))
            .set_rest_weekdays(&[6], "2026-07-29")
            .expect("rest day should save");
        CyclePlanUseCases::new(SqliteCyclePlanRepository::new(directory))
    }

    trait ConfirmShiftTestExt {
        fn shift_plan(
            &self,
            input: &ShiftCyclePlanInput,
        ) -> Result<ShiftCyclePlanResult, CyclePlanError>;
    }

    impl<R: CyclePlanRepository> ConfirmShiftTestExt for CyclePlanUseCases<R> {
        fn shift_plan(
            &self,
            input: &ShiftCyclePlanInput,
        ) -> Result<ShiftCyclePlanResult, CyclePlanError> {
            let preview = self.preview_shift_plan(input)?;
            let preview_token = preview
                .preview_token
                .ok_or(CyclePlanError::ShiftPreviewStale)?;
            self.confirm_shift_plan(&ConfirmShiftCyclePlanInput {
                plan_id: input.plan_id.clone(),
                from_date: input.from_date.clone(),
                study_days: input.study_days,
                preview_token,
            })
        }
    }

    fn save_plan(
        use_cases: &CyclePlanUseCases<SqliteCyclePlanRepository>,
    ) -> crate::domain::CyclePlanDashboard {
        use_cases
            .save_plan(&SaveCyclePlanInput {
                plan_id: None,
                expected_updated_at: None,
                name: "cycle test".to_owned(),
                total_units: 1,
                unit_label: "unit".to_owned(),
                start_date: "2026-07-29".to_owned(),
                deadline: "2026-08-20".to_owned(),
                study_days_per_unit: 2,
                schedule_mode: "rhythm".to_owned(),
                calendar_visible: true,
            })
            .expect("plan should save")
    }

    #[test]
    fn plan_progress_and_shift_round_trip_without_rewriting_completed_items() {
        let directory = tempdir().expect("temporary directory should exist");
        SqliteWorkspaceRepository::new(directory.path())
            .initialize_default(&NewWorkspace::default_at(1_700_000_000_000))
            .expect("workspace should initialize");
        ReviewSchemeUseCases::new(SqliteReviewSchemeRepository::new(directory.path()))
            .set_rest_weekdays(&[6], "2026-07-29")
            .expect("rest day should save");
        let use_cases = CyclePlanUseCases::new(SqliteCyclePlanRepository::new(directory.path()));
        let created = use_cases
            .save_plan(&SaveCyclePlanInput {
                plan_id: None,
                expected_updated_at: None,
                name: "模拟卷".to_owned(),
                total_units: 3,
                unit_label: "套".to_owned(),
                start_date: "2026-07-29".to_owned(),
                deadline: "2026-08-20".to_owned(),
                study_days_per_unit: 2,
                schedule_mode: "rhythm".to_owned(),
                calendar_visible: true,
            })
            .expect("plan should save");
        let plan_id = created.plans[0].plan.id.clone();
        let first = created.plans[0].items[0].clone();
        let second_start = created.plans[0].items[1].planned_start_date.clone();
        let completed = use_cases
            .set_item_state(&SetCyclePlanItemStateInput {
                item_id: first.id.clone(),
                target_state: "completed".to_owned(),
                expected_updated_at: first.updated_at,
            })
            .expect("item should complete");
        assert_eq!(completed.dashboard.plans[0].progress_percent, 33);

        let shifted = use_cases
            .shift_plan(&ShiftCyclePlanInput {
                plan_id,
                from_date: second_start.as_str().to_owned(),
                study_days: 1,
            })
            .expect("pending items should shift");

        assert_eq!(
            shifted.dashboard.plans[0].items[0].state,
            CyclePlanItemState::Completed
        );
        assert_eq!(
            shifted.dashboard.plans[0].items[0].planned_start_date,
            first.planned_start_date
        );
        assert!(shifted.dashboard.plans[0].items[1].planned_start_date > second_start);
        assert_eq!(shifted.dashboard.plans[0].items[1].shift_count, 1);
    }

    #[test]
    fn shrinking_below_the_highest_completed_unit_is_rejected_without_writes() {
        let directory = tempdir().expect("temporary directory should exist");
        let use_cases = use_cases(directory.path());
        let created = use_cases
            .save_plan(&SaveCyclePlanInput {
                plan_id: None,
                expected_updated_at: None,
                name: "twenty-unit cycle".to_owned(),
                total_units: 20,
                unit_label: "unit".to_owned(),
                start_date: "2026-07-29".to_owned(),
                deadline: "2026-12-31".to_owned(),
                study_days_per_unit: 1,
                schedule_mode: "rhythm".to_owned(),
                calendar_visible: true,
            })
            .expect("plan should save");
        let plan_id = created.plans[0].plan.id.clone();
        let twentieth = created.plans[0].items[19].clone();
        let completed = use_cases
            .set_item_state(&SetCyclePlanItemStateInput {
                item_id: twentieth.id,
                target_state: "completed".to_owned(),
                expected_updated_at: twentieth.updated_at,
            })
            .expect("the twentieth item should complete");
        let first = completed.dashboard.plans[0].items[0].clone();
        let shifted = use_cases
            .shift_plan(&ShiftCyclePlanInput {
                plan_id: plan_id.clone(),
                from_date: first.planned_start_date.as_str().to_owned(),
                study_days: 1,
            })
            .expect("shift should create an undo snapshot before the rejected save");
        let undo = shifted.undo.expect("the shift should return an undo token");
        let before = shifted.dashboard;

        let error = use_cases
            .save_plan(&SaveCyclePlanInput {
                plan_id: Some(plan_id.clone()),
                expected_updated_at: Some(before.plans[0].plan.updated_at),
                name: "attempted shrink".to_owned(),
                total_units: 1,
                unit_label: "changed".to_owned(),
                start_date: "2026-08-01".to_owned(),
                deadline: "2026-12-31".to_owned(),
                study_days_per_unit: 2,
                schedule_mode: "even".to_owned(),
                calendar_visible: false,
            })
            .expect_err("a terminal item beyond the new total must reject the shrink");
        assert!(matches!(error, CyclePlanError::CompletedProgressConflict));

        let after = use_cases.dashboard().expect("dashboard should still load");
        assert_eq!(after, before);
        let restored = use_cases
            .undo_shift_plan(&UndoShiftCyclePlanInput {
                plan_id,
                undo_token: undo.undo_token,
            })
            .expect("the rejected save must leave the prior undo token usable");
        assert_eq!(
            restored.plans[0].items[0].planned_start_date,
            first.planned_start_date
        );
    }

    #[test]
    fn legal_shrink_removes_all_pending_items_beyond_the_new_total() {
        let directory = tempdir().expect("temporary directory should exist");
        let use_cases = use_cases(directory.path());
        let created = use_cases
            .save_plan(&SaveCyclePlanInput {
                plan_id: None,
                expected_updated_at: None,
                name: "shrinkable cycle".to_owned(),
                total_units: 5,
                unit_label: "unit".to_owned(),
                start_date: "2026-07-29".to_owned(),
                deadline: "2026-12-31".to_owned(),
                study_days_per_unit: 1,
                schedule_mode: "rhythm".to_owned(),
                calendar_visible: true,
            })
            .expect("plan should save");

        let shrunk = use_cases
            .save_plan(&SaveCyclePlanInput {
                plan_id: Some(created.plans[0].plan.id.clone()),
                expected_updated_at: Some(created.plans[0].plan.updated_at),
                name: "shrinkable cycle".to_owned(),
                total_units: 3,
                unit_label: "unit".to_owned(),
                start_date: "2026-07-29".to_owned(),
                deadline: "2026-12-31".to_owned(),
                study_days_per_unit: 1,
                schedule_mode: "rhythm".to_owned(),
                calendar_visible: true,
            })
            .expect("a pending-only shrink should succeed");

        let overview = &shrunk.plans[0];
        assert_eq!(overview.plan.total_units, 3);
        assert_eq!(overview.items.len(), 3);
        assert_eq!(
            overview
                .items
                .iter()
                .map(|item| item.unit_index)
                .collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
    }

    #[test]
    fn ordinary_plan_save_still_generates_each_requested_item() {
        let directory = tempdir().expect("temporary directory should exist");
        let use_cases = use_cases(directory.path());

        let dashboard = use_cases
            .save_plan(&SaveCyclePlanInput {
                plan_id: None,
                expected_updated_at: None,
                name: "ordinary cycle".to_owned(),
                total_units: 3,
                unit_label: "unit".to_owned(),
                start_date: "2026-07-29".to_owned(),
                deadline: "2026-12-31".to_owned(),
                study_days_per_unit: 1,
                schedule_mode: "rhythm".to_owned(),
                calendar_visible: true,
            })
            .expect("plan should save");

        assert_eq!(dashboard.plans.len(), 1);
        assert_eq!(dashboard.plans[0].plan.total_units, 3);
        assert_eq!(dashboard.plans[0].items.len(), 3);
    }

    fn update_plan(
        use_cases: &CyclePlanUseCases<SqliteCyclePlanRepository>,
        plan_id: &str,
        expected_updated_at: Option<i64>,
        name: &str,
    ) -> Result<crate::domain::CyclePlanDashboard, CyclePlanError> {
        use_cases.save_plan(&SaveCyclePlanInput {
            plan_id: Some(plan_id.to_owned()),
            expected_updated_at,
            name: name.to_owned(),
            total_units: 3,
            unit_label: "unit".to_owned(),
            start_date: "2026-07-29".to_owned(),
            deadline: "2026-12-31".to_owned(),
            study_days_per_unit: 1,
            schedule_mode: "rhythm".to_owned(),
            calendar_visible: true,
        })
    }

    #[test]
    fn stale_save_after_aggregate_changes_is_zero_write_and_preserves_undo() {
        let directory = tempdir().expect("temporary directory should exist");
        let use_cases = use_cases(directory.path());
        let repository = SqliteCyclePlanRepository::new(directory.path());
        let created = use_cases
            .save_plan(&SaveCyclePlanInput {
                plan_id: None,
                expected_updated_at: None,
                name: "CAS cycle".to_owned(),
                total_units: 3,
                unit_label: "unit".to_owned(),
                start_date: "2026-07-29".to_owned(),
                deadline: "2026-12-31".to_owned(),
                study_days_per_unit: 1,
                schedule_mode: "rhythm".to_owned(),
                calendar_visible: true,
            })
            .expect("plan should save");
        let plan_id = created.plans[0].plan.id.clone();
        let original_revision = created.plans[0].plan.updated_at;
        let saved = update_plan(&use_cases, &plan_id, Some(original_revision), "window A")
            .expect("window A should save");
        assert!(saved.plans[0].plan.updated_at > original_revision);
        let item = saved.plans[0].items[0].clone();
        let shifted = use_cases
            .shift_plan(&ShiftCyclePlanInput {
                plan_id: plan_id.clone(),
                from_date: item.planned_start_date.as_str().to_owned(),
                study_days: 1,
            })
            .expect("shift should create an undo after window A");
        let undo = shifted.undo.expect("shift should return undo");
        let before_stale_save = shifted.dashboard;

        let error = update_plan(&use_cases, &plan_id, Some(original_revision), "window B")
            .expect_err("window B must not overwrite the aggregate");
        assert!(matches!(error, CyclePlanError::SaveStale));
        assert_eq!(
            use_cases
                .dashboard()
                .expect("dashboard should remain unchanged"),
            before_stale_save
        );
        assert_stored_undo(&repository, &undo);

        let shift_revision = before_stale_save.plans[0].plan.updated_at;
        let after_undo = use_cases
            .undo_shift_plan(&UndoShiftCyclePlanInput {
                plan_id: plan_id.clone(),
                undo_token: undo.undo_token,
            })
            .expect("undo should succeed");
        assert!(after_undo.plans[0].plan.updated_at > shift_revision);
        let error = update_plan(
            &use_cases,
            &plan_id,
            Some(shift_revision),
            "after undo stale",
        )
        .expect_err("undo must invalidate the prior save token");
        assert!(matches!(error, CyclePlanError::SaveStale));

        let before_state_revision = after_undo.plans[0].plan.updated_at;
        let current_item = after_undo.plans[0].items[0].clone();
        let after_state = use_cases
            .set_item_state(&SetCyclePlanItemStateInput {
                item_id: current_item.id,
                target_state: "completed".to_owned(),
                expected_updated_at: current_item.updated_at,
            })
            .expect("item state should change");
        assert!(after_state.dashboard.plans[0].plan.updated_at > before_state_revision);
        let error = update_plan(
            &use_cases,
            &plan_id,
            Some(before_state_revision),
            "after state stale",
        )
        .expect_err("item changes must invalidate the prior save token");
        assert!(matches!(error, CyclePlanError::SaveStale));

        assert_restore_refresh_and_archive_invalidate_save(
            directory.path(),
            &use_cases,
            &plan_id,
            &after_state.dashboard,
        );
    }

    #[test]
    fn stale_archive_is_zero_write_and_preserves_the_latest_shift_undo() {
        let directory = tempdir().expect("temporary directory should exist");
        let use_cases = use_cases(directory.path());
        let repository = SqliteCyclePlanRepository::new(directory.path());
        let created = save_plan(&use_cases);
        let plan_id = created.plans[0].plan.id.clone();
        let stale_revision = created.plans[0].plan.updated_at;
        let item = created.plans[0].items[0].clone();
        let shifted = use_cases
            .shift_plan(&ShiftCyclePlanInput {
                plan_id: plan_id.clone(),
                from_date: item.planned_start_date.as_str().to_owned(),
                study_days: 1,
            })
            .expect("shift should create the latest undo");
        let undo = shifted.undo.expect("shift should return undo");
        let before_archive = shifted.dashboard;

        let error = use_cases
            .archive_plan(&plan_id, stale_revision)
            .expect_err("stale archive must not overwrite the aggregate");

        assert!(matches!(error, CyclePlanError::SaveStale));
        assert_eq!(
            use_cases
                .dashboard()
                .expect("dashboard should remain unchanged"),
            before_archive
        );
        assert_stored_undo(&repository, &undo);
    }

    fn assert_restore_refresh_and_archive_invalidate_save(
        directory: &Path,
        use_cases: &CyclePlanUseCases<SqliteCyclePlanRepository>,
        plan_id: &str,
        after_state: &crate::domain::CyclePlanDashboard,
    ) {
        let before_restore_revision = after_state.plans[0].plan.updated_at;
        let completed_item = after_state.plans[0].items[0].clone();
        let restored = use_cases
            .restore_item_state(&RestoreCyclePlanItemStateInput {
                item_id: completed_item.id,
                original_state: "pending".to_owned(),
                original_completed_at: None,
                original_skipped_at: None,
                expected_updated_at: completed_item.updated_at,
            })
            .expect("item state should restore");
        assert!(restored.plans[0].plan.updated_at > before_restore_revision);
        let error = update_plan(
            use_cases,
            plan_id,
            Some(before_restore_revision),
            "after restore stale",
        )
        .expect_err("restore must invalidate the prior save token");
        assert!(matches!(error, CyclePlanError::SaveStale));

        let before_refresh_revision = restored.plans[0].plan.updated_at;
        ReviewSchemeUseCases::new(SqliteReviewSchemeRepository::new(directory))
            .set_rest_weekdays(&[5], "2026-07-29")
            .expect("global rest weekdays should change");
        let refreshed = use_cases
            .refresh_schedules()
            .expect("rest-day schedule refresh should succeed");
        assert!(refreshed.plans[0].plan.updated_at > before_refresh_revision);
        let error = update_plan(
            use_cases,
            plan_id,
            Some(before_refresh_revision),
            "after refresh stale",
        )
        .expect_err("refresh must invalidate the prior save token");
        assert!(matches!(error, CyclePlanError::SaveStale));

        let before_archive_revision = refreshed.plans[0].plan.updated_at;
        use_cases
            .archive_plan(plan_id, before_archive_revision)
            .expect("plan should archive");
        let error = update_plan(
            use_cases,
            plan_id,
            Some(before_archive_revision),
            "after archive missing",
        )
        .expect_err("archived plans must be classified as not found");
        assert!(matches!(error, CyclePlanError::PlanNotFound));
    }

    #[test]
    fn save_requires_matching_create_update_token_shapes_and_rejects_id_collision() {
        let directory = tempdir().expect("temporary directory should exist");
        let use_cases = use_cases(directory.path());
        let repository = SqliteCyclePlanRepository::new(directory.path());
        let error = use_cases
            .save_plan(&SaveCyclePlanInput {
                plan_id: None,
                expected_updated_at: Some(1),
                name: "invalid create".to_owned(),
                total_units: 1,
                unit_label: "unit".to_owned(),
                start_date: "2026-07-29".to_owned(),
                deadline: "2026-12-31".to_owned(),
                study_days_per_unit: 1,
                schedule_mode: "rhythm".to_owned(),
                calendar_visible: true,
            })
            .expect_err("create must not accept an expected version");
        assert!(matches!(error, CyclePlanError::InvalidInput));

        let created = save_plan(&use_cases);
        let plan = created.plans[0].plan.clone();
        let error = update_plan(&use_cases, &plan.id, None, "invalid update")
            .expect_err("update must require an expected version");
        assert!(matches!(error, CyclePlanError::InvalidInput));
        let error = update_plan(
            &use_cases,
            "019f7328-4b66-7613-9729-e3570fc41525",
            Some(plan.updated_at),
            "missing update",
        )
        .expect_err("missing update targets must be not found");
        assert!(matches!(error, CyclePlanError::PlanNotFound));
        let generated = created.plans[0]
            .items
            .iter()
            .map(|item| GeneratedCyclePlanItem {
                id: item.id.clone(),
                unit_index: item.unit_index,
                start_date: item.planned_start_date.clone(),
                end_date: item.planned_end_date.clone(),
            })
            .collect::<Vec<_>>();
        let error = repository
            .save_plan(&plan, &generated, None)
            .expect_err("create collision must be stale");
        assert!(matches!(error, CyclePlanError::SaveStale));
        assert_eq!(
            use_cases
                .dashboard()
                .expect("dashboard should remain unchanged"),
            created
        );
    }

    #[test]
    fn archived_plan_save_is_rejected_without_modifying_plan_items_or_undo() {
        let directory = tempdir().expect("temporary directory should exist");
        let use_cases = use_cases(directory.path());
        let repository = SqliteCyclePlanRepository::new(directory.path());
        let created = save_plan(&use_cases);
        let item = created.plans[0].items[0].clone();
        let shifted = use_cases
            .shift_plan(&ShiftCyclePlanInput {
                plan_id: item.plan_id.clone(),
                from_date: item.planned_start_date.as_str().to_owned(),
                study_days: 1,
            })
            .expect("shift should create an undo snapshot");
        let undo = shifted.undo.expect("shift should return an undo token");
        let mut attempted_plan = shifted.dashboard.plans[0].plan.clone();
        attempted_plan.name = "must not overwrite archived plan".to_owned();
        attempted_plan.updated_at += 1;
        let generated = shifted.dashboard.plans[0]
            .items
            .iter()
            .map(|current| GeneratedCyclePlanItem {
                id: current.id.clone(),
                unit_index: current.unit_index,
                start_date: current.planned_start_date.clone(),
                end_date: current.planned_end_date.clone(),
            })
            .collect::<Vec<_>>();

        let connection = repository.open().expect("database should open");
        connection
            .execute(
                "UPDATE cycle_plan SET archived_at = ?2 WHERE id = ?1",
                params![attempted_plan.id, 1_700_000_000_500_i64],
            )
            .expect("test should archive without consuming undo");
        let plan_before = connection
            .query_row(
                "SELECT name, total_units, updated_at, archived_at
                 FROM cycle_plan WHERE id = ?1",
                [&attempted_plan.id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, u32>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, Option<i64>>(3)?,
                    ))
                },
            )
            .expect("archived plan should remain stored");
        let items_before = load_items(&connection, &attempted_plan.id).expect("items should load");
        let undo_before = connection
            .query_row(
                "SELECT undo_token, expires_at FROM cycle_plan_shift_undo WHERE plan_id = ?1",
                [&attempted_plan.id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
            )
            .expect("undo should remain stored");
        assert_eq!(undo_before.0, undo.undo_token);
        drop(connection);
        let dashboard_before = use_cases.dashboard().expect("dashboard should load");

        let error = repository
            .save_plan(&attempted_plan, &generated, Some(attempted_plan.updated_at))
            .expect_err("an archived plan must not be revived");
        assert!(matches!(error, CyclePlanError::PlanNotFound));

        let connection = repository.open().expect("database should reopen");
        let plan_after = connection
            .query_row(
                "SELECT name, total_units, updated_at, archived_at
                 FROM cycle_plan WHERE id = ?1",
                [&attempted_plan.id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, u32>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, Option<i64>>(3)?,
                    ))
                },
            )
            .expect("archived plan should remain stored");
        let items_after = load_items(&connection, &attempted_plan.id).expect("items should load");
        let undo_after = connection
            .query_row(
                "SELECT undo_token, expires_at FROM cycle_plan_shift_undo WHERE plan_id = ?1",
                [&attempted_plan.id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
            )
            .expect("undo should remain stored");
        assert_eq!(plan_after, plan_before);
        assert_eq!(items_after, items_before);
        assert_eq!(undo_after, undo_before);
        assert_eq!(
            use_cases.dashboard().expect("dashboard should still load"),
            dashboard_before
        );
    }

    #[test]
    fn sparse_completed_units_use_the_highest_index_and_keep_completed_fields() {
        let directory = tempdir().expect("temporary directory should exist");
        let use_cases = use_cases(directory.path());
        let created = use_cases
            .save_plan(&SaveCyclePlanInput {
                plan_id: None,
                expected_updated_at: None,
                name: "sparse completion cycle".to_owned(),
                total_units: 6,
                unit_label: "unit".to_owned(),
                start_date: "2026-07-29".to_owned(),
                deadline: "2026-12-31".to_owned(),
                study_days_per_unit: 1,
                schedule_mode: "rhythm".to_owned(),
                calendar_visible: true,
            })
            .expect("plan should save");
        let plan_id = created.plans[0].plan.id.clone();
        let second = created.plans[0].items[1].clone();
        let fifth = created.plans[0].items[4].clone();
        use_cases
            .set_item_state(&SetCyclePlanItemStateInput {
                item_id: second.id,
                target_state: "completed".to_owned(),
                expected_updated_at: second.updated_at,
            })
            .expect("unit two should complete");
        let completed = use_cases
            .set_item_state(&SetCyclePlanItemStateInput {
                item_id: fifth.id,
                target_state: "completed".to_owned(),
                expected_updated_at: fifth.updated_at,
            })
            .expect("unit five should complete");
        let completed_second = completed.dashboard.plans[0].items[1].clone();
        let completed_fifth = completed.dashboard.plans[0].items[4].clone();

        let shrunk = use_cases
            .save_plan(&SaveCyclePlanInput {
                plan_id: Some(plan_id.clone()),
                expected_updated_at: Some(completed.dashboard.plans[0].plan.updated_at),
                name: "sparse completion cycle updated".to_owned(),
                total_units: 5,
                unit_label: "unit".to_owned(),
                start_date: "2026-08-01".to_owned(),
                deadline: "2026-12-31".to_owned(),
                study_days_per_unit: 2,
                schedule_mode: "even".to_owned(),
                calendar_visible: false,
            })
            .expect("shrinking to the highest completed index should succeed");
        assert_eq!(shrunk.plans[0].items.len(), 5);
        assert_eq!(shrunk.plans[0].items[1], completed_second);
        assert_eq!(shrunk.plans[0].items[4], completed_fifth);
        let before_rejection = shrunk.clone();

        let error = use_cases
            .save_plan(&SaveCyclePlanInput {
                plan_id: Some(plan_id),
                expected_updated_at: Some(shrunk.plans[0].plan.updated_at),
                name: "must not shrink".to_owned(),
                total_units: 4,
                unit_label: "changed".to_owned(),
                start_date: "2026-08-02".to_owned(),
                deadline: "2026-12-31".to_owned(),
                study_days_per_unit: 3,
                schedule_mode: "rhythm".to_owned(),
                calendar_visible: true,
            })
            .expect_err("shrinking below completed unit five must fail");
        assert!(matches!(error, CyclePlanError::CompletedProgressConflict));
        assert_eq!(
            use_cases
                .dashboard()
                .expect("dashboard should remain unchanged"),
            before_rejection
        );
    }

    #[test]
    fn shift_undo_restores_the_backend_snapshot_and_consumes_the_token() {
        let directory = tempdir().expect("temporary directory should exist");
        let use_cases = use_cases(directory.path());
        let created = save_plan(&use_cases);
        let item = created.plans[0].items[0].clone();

        let shifted = use_cases
            .shift_plan(&ShiftCyclePlanInput {
                plan_id: item.plan_id.clone(),
                from_date: item.planned_start_date.as_str().to_owned(),
                study_days: 1,
            })
            .expect("shift should save an undo snapshot");
        let undo = shifted
            .undo
            .clone()
            .expect("shift should return an undo token");
        let shifted_item = shifted.dashboard.plans[0].items[0].clone();
        assert_eq!(shifted.shifted_item_count, 1);
        assert_ne!(shifted_item.planned_start_date, item.planned_start_date);

        let restored = use_cases
            .undo_shift_plan(&UndoShiftCyclePlanInput {
                plan_id: undo.plan_id,
                undo_token: undo.undo_token.clone(),
            })
            .expect("undo should restore the exact snapshot");
        let restored_item = &restored.plans[0].items[0];
        assert_eq!(restored_item.planned_start_date, item.planned_start_date);
        assert_eq!(restored_item.planned_end_date, item.planned_end_date);
        assert_eq!(restored_item.shift_count, item.shift_count);
        assert!(restored_item.updated_at > shifted_item.updated_at);

        let error = use_cases
            .undo_shift_plan(&UndoShiftCyclePlanInput {
                plan_id: item.plan_id,
                undo_token: undo.undo_token,
            })
            .expect_err("a consumed token must not be reusable");
        assert!(matches!(error, CyclePlanError::ShiftUndoUnavailable));
    }

    #[test]
    fn latest_shift_supersedes_the_previous_undo_token() {
        let directory = tempdir().expect("temporary directory should exist");
        let use_cases = use_cases(directory.path());
        let created = save_plan(&use_cases);
        let item = created.plans[0].items[0].clone();

        let first = use_cases
            .shift_plan(&ShiftCyclePlanInput {
                plan_id: item.plan_id.clone(),
                from_date: item.planned_start_date.as_str().to_owned(),
                study_days: 1,
            })
            .expect("first shift should save an undo snapshot");
        let first_undo = first.undo.expect("first shift should return an undo token");
        let second = use_cases
            .shift_plan(&ShiftCyclePlanInput {
                plan_id: item.plan_id.clone(),
                from_date: first.dashboard.plans[0].items[0]
                    .planned_start_date
                    .as_str()
                    .to_owned(),
                study_days: 1,
            })
            .expect("second shift should replace the previous snapshot");
        let second_undo = second
            .undo
            .expect("second shift should return an undo token");

        let error = use_cases
            .undo_shift_plan(&UndoShiftCyclePlanInput {
                plan_id: first_undo.plan_id,
                undo_token: first_undo.undo_token,
            })
            .expect_err("the previous token must be superseded");
        assert!(matches!(error, CyclePlanError::ShiftUndoUnavailable));

        use_cases
            .undo_shift_plan(&UndoShiftCyclePlanInput {
                plan_id: second_undo.plan_id,
                undo_token: second_undo.undo_token,
            })
            .expect("the latest token should remain usable");
    }

    #[test]
    fn the_second_window_confirm_is_stale_and_preserves_the_first_undo() {
        let directory = tempdir().expect("temporary directory should exist");
        let use_cases = use_cases(directory.path());
        let repository = SqliteCyclePlanRepository::new(directory.path());
        let created = save_plan(&use_cases);
        let item = created.plans[0].items[0].clone();
        let input = ShiftCyclePlanInput {
            plan_id: item.plan_id.clone(),
            from_date: item.planned_start_date.as_str().to_owned(),
            study_days: 1,
        };
        let preview = use_cases
            .preview_shift_plan(&input)
            .expect("both windows should share this preview");
        let preview_token = preview.preview_token.expect("preview should have a token");
        let confirm = ConfirmShiftCyclePlanInput {
            plan_id: input.plan_id,
            from_date: input.from_date,
            study_days: input.study_days,
            preview_token,
        };
        let first = use_cases
            .confirm_shift_plan(&confirm)
            .expect("the first window should confirm");
        let undo = first.undo.expect("the first confirm should create undo");

        let error = use_cases
            .confirm_shift_plan(&confirm)
            .expect_err("the second window must observe a stale preview");
        assert!(matches!(error, CyclePlanError::ShiftPreviewStale));
        let connection = repository.open().expect("database should open");
        let stored_token: String = connection
            .query_row(
                "SELECT undo_token FROM cycle_plan_shift_undo WHERE plan_id = ?1",
                [&undo.plan_id],
                |row| row.get(0),
            )
            .expect("stale confirm must preserve the latest undo");
        assert_eq!(stored_token, undo.undo_token);
    }

    #[test]
    fn rest_plan_and_item_changes_each_make_preview_stale_without_deleting_undo() {
        let directory = tempdir().expect("temporary directory should exist");
        let use_cases = use_cases(directory.path());
        let repository = SqliteCyclePlanRepository::new(directory.path());
        let created = save_plan(&use_cases);
        let item = created.plans[0].items[0].clone();
        let shifted = use_cases
            .shift_plan(&ShiftCyclePlanInput {
                plan_id: item.plan_id.clone(),
                from_date: item.planned_start_date.as_str().to_owned(),
                study_days: 1,
            })
            .expect("initial shift should create undo");
        let undo = shifted.undo.expect("initial shift should return undo");
        let shifted_item = shifted.dashboard.plans[0].items[0].clone();
        let input = ShiftCyclePlanInput {
            plan_id: item.plan_id.clone(),
            from_date: shifted_item.planned_start_date.as_str().to_owned(),
            study_days: 1,
        };

        let rest_preview = use_cases
            .preview_shift_plan(&input)
            .expect("rest preview should succeed");
        let connection = repository.open().expect("database should open");
        let workspace_id = workspace_id(&connection).expect("workspace should exist");
        connection
            .execute(
                "INSERT INTO workspace_rest_weekday(workspace_id, weekday, created_at)
                 VALUES (?1, 5, 1700000000000)",
                [&workspace_id],
            )
            .expect("test should change rest weekdays");
        drop(connection);
        assert_preview_stale(&use_cases, &input, rest_preview.preview_token);
        assert_stored_undo(&repository, &undo);

        let plan_preview = use_cases
            .preview_shift_plan(&input)
            .expect("plan preview should succeed");
        let connection = repository.open().expect("database should open");
        connection
            .execute(
                "UPDATE cycle_plan SET updated_at = updated_at + 1 WHERE id = ?1",
                [&item.plan_id],
            )
            .expect("test should change the plan version");
        drop(connection);
        assert_preview_stale(&use_cases, &input, plan_preview.preview_token);
        assert_stored_undo(&repository, &undo);

        let item_preview = use_cases
            .preview_shift_plan(&input)
            .expect("item preview should succeed");
        let connection = repository.open().expect("database should open");
        connection
            .execute(
                "UPDATE cycle_plan_item SET updated_at = updated_at + 1 WHERE id = ?1",
                [&shifted_item.id],
            )
            .expect("test should change the item version");
        drop(connection);
        assert_preview_stale(&use_cases, &input, item_preview.preview_token);
        assert_stored_undo(&repository, &undo);
    }

    fn assert_preview_stale(
        use_cases: &CyclePlanUseCases<SqliteCyclePlanRepository>,
        input: &ShiftCyclePlanInput,
        preview_token: Option<String>,
    ) {
        let error = use_cases
            .confirm_shift_plan(&ConfirmShiftCyclePlanInput {
                plan_id: input.plan_id.clone(),
                from_date: input.from_date.clone(),
                study_days: input.study_days,
                preview_token: preview_token.expect("preview should include a token"),
            })
            .expect_err("changed authoritative state must stale the preview");
        assert!(matches!(error, CyclePlanError::ShiftPreviewStale));
    }

    fn assert_stored_undo(
        repository: &SqliteCyclePlanRepository,
        undo: &crate::application::ShiftCyclePlanUndo,
    ) {
        let connection = repository.open().expect("database should open");
        let stored_token: String = connection
            .query_row(
                "SELECT undo_token FROM cycle_plan_shift_undo WHERE plan_id = ?1",
                [&undo.plan_id],
                |row| row.get(0),
            )
            .expect("stale confirm must not delete the existing undo");
        assert_eq!(stored_token, undo.undo_token);
    }

    #[test]
    fn zero_item_preview_has_no_token_and_does_not_write() {
        let directory = tempdir().expect("temporary directory should exist");
        let use_cases = use_cases(directory.path());
        let created = save_plan(&use_cases);
        let item = created.plans[0].items[0].clone();
        let first = use_cases
            .shift_plan(&ShiftCyclePlanInput {
                plan_id: item.plan_id.clone(),
                from_date: item.planned_start_date.as_str().to_owned(),
                study_days: 1,
            })
            .expect("first shift should save an undo snapshot");
        let first_undo = first.undo.expect("first shift should return an undo token");
        let before_preview = use_cases.dashboard().expect("dashboard should load");

        let no_op = use_cases
            .preview_shift_plan(&ShiftCyclePlanInput {
                plan_id: item.plan_id.clone(),
                from_date: "2099-01-01".to_owned(),
                study_days: 1,
            })
            .expect("empty preview should succeed without a token");
        assert_eq!(no_op.affected_item_count, 0);
        assert!(no_op.preview_token.is_none());
        assert_eq!(
            use_cases
                .dashboard()
                .expect("dashboard should remain unchanged"),
            before_preview
        );

        use_cases
            .undo_shift_plan(&UndoShiftCyclePlanInput {
                plan_id: first_undo.plan_id,
                undo_token: first_undo.undo_token,
            })
            .expect("a read-only empty preview must preserve the previous undo token");
    }

    #[test]
    fn malformed_confirm_token_and_archived_preview_are_rejected() {
        let directory = tempdir().expect("temporary directory should exist");
        let use_cases = use_cases(directory.path());
        let created = save_plan(&use_cases);
        let plan_id = created.plans[0].plan.id.clone();
        let item = created.plans[0].items[0].clone();
        let error = use_cases
            .confirm_shift_plan(&ConfirmShiftCyclePlanInput {
                plan_id: plan_id.clone(),
                from_date: item.planned_start_date.as_str().to_owned(),
                study_days: 1,
                preview_token: "not-a-preview-token".to_owned(),
            })
            .expect_err("malformed preview tokens must be invalid input");
        assert!(matches!(error, CyclePlanError::InvalidInput));

        use_cases
            .archive_plan(&plan_id, created.plans[0].plan.updated_at)
            .expect("plan should archive");
        let error = use_cases
            .preview_shift_plan(&ShiftCyclePlanInput {
                plan_id,
                from_date: item.planned_start_date.as_str().to_owned(),
                study_days: 1,
            })
            .expect_err("archived plans must not be previewed");
        assert!(matches!(error, CyclePlanError::PlanNotFound));
    }

    #[test]
    fn shift_undo_is_rejected_at_the_exact_expiry_boundary() {
        let directory = tempdir().expect("temporary directory should exist");
        let repository = SqliteCyclePlanRepository::new(directory.path());
        let use_cases = use_cases(directory.path());
        let created = save_plan(&use_cases);
        let item = created.plans[0].items[0].clone();
        let shifted = use_cases
            .shift_plan(&ShiftCyclePlanInput {
                plan_id: item.plan_id.clone(),
                from_date: item.planned_start_date.as_str().to_owned(),
                study_days: 1,
            })
            .expect("shift should save an undo snapshot");
        let undo = shifted.undo.expect("shift should return an undo token");
        let connection = repository.open().expect("database should open");
        let expires_at: i64 = connection
            .query_row(
                "SELECT expires_at FROM cycle_plan_shift_undo WHERE undo_token = ?1",
                [&undo.undo_token],
                |row| row.get(0),
            )
            .expect("undo expiry should be stored");
        drop(connection);

        let error = repository
            .undo_shifted_items(&item.plan_id, &undo.undo_token, expires_at)
            .expect_err("expiry equality must be unavailable");
        assert!(matches!(error, CyclePlanError::ShiftUndoUnavailable));
        let current = use_cases.dashboard().expect("dashboard should load");
        assert_eq!(
            current.plans[0].items[0].planned_start_date,
            shifted.dashboard.plans[0].items[0].planned_start_date
        );
    }

    #[test]
    fn cross_window_row_conflict_rolls_back_the_entire_shift_undo() {
        let directory = tempdir().expect("temporary directory should exist");
        let repository = SqliteCyclePlanRepository::new(directory.path());
        let use_cases = use_cases(directory.path());
        let created = use_cases
            .save_plan(&SaveCyclePlanInput {
                plan_id: None,
                expected_updated_at: None,
                name: "multi-item cycle test".to_owned(),
                total_units: 3,
                unit_label: "unit".to_owned(),
                start_date: "2026-07-29".to_owned(),
                deadline: "2026-08-20".to_owned(),
                study_days_per_unit: 2,
                schedule_mode: "rhythm".to_owned(),
                calendar_visible: true,
            })
            .expect("plan should save");
        let plan_id = created.plans[0].plan.id.clone();
        let first = created.plans[0].items[0].clone();
        let second = created.plans[0].items[1].clone();
        let shifted = use_cases
            .shift_plan(&ShiftCyclePlanInput {
                plan_id: plan_id.clone(),
                from_date: first.planned_start_date.as_str().to_owned(),
                study_days: 1,
            })
            .expect("shift should save an undo snapshot");
        let undo = shifted.undo.expect("shift should return an undo token");
        let shifted_first = shifted.dashboard.plans[0].items[0].clone();

        let connection = repository.open().expect("database should open");
        connection
            .execute(
                "UPDATE cycle_plan_item
                 SET planned_start_date = '2099-01-01', updated_at = updated_at + 100
                 WHERE id = ?1",
                [&second.id],
            )
            .expect("test should create a concurrent row conflict");

        let error = use_cases
            .undo_shift_plan(&UndoShiftCyclePlanInput {
                plan_id,
                undo_token: undo.undo_token,
            })
            .expect_err("a concurrent row change must reject the whole undo");
        assert!(matches!(error, CyclePlanError::ShiftUndoStale));
        let current = use_cases.dashboard().expect("dashboard should load");
        assert_eq!(
            current.plans[0].items[0].planned_start_date,
            shifted_first.planned_start_date
        );
        assert_eq!(
            current.plans[0].items[1].planned_start_date.as_str(),
            "2099-01-01"
        );
    }

    #[test]
    fn item_state_updates_bump_versions_in_both_directions_and_restore_exact_timestamp() {
        let directory = tempdir().expect("temporary directory should exist");
        let use_cases = use_cases(directory.path());
        let created = save_plan(&use_cases);
        let item = created.plans[0].items[0].clone();

        let completed = use_cases
            .set_item_state(&SetCyclePlanItemStateInput {
                item_id: item.id.clone(),
                target_state: "completed".to_owned(),
                expected_updated_at: item.updated_at,
            })
            .expect("item should complete");
        let completed_item = &completed.dashboard.plans[0].items[0];
        assert_eq!(completed_item.state, CyclePlanItemState::Completed);
        assert!(completed_item.completed_at.is_some());
        assert!(completed_item.updated_at > item.updated_at);
        assert_eq!(completed.item_updated_at, completed_item.updated_at);

        let restored = use_cases
            .restore_item_state(&RestoreCyclePlanItemStateInput {
                item_id: item.id.clone(),
                original_state: "pending".to_owned(),
                original_completed_at: None,
                original_skipped_at: None,
                expected_updated_at: completed_item.updated_at,
            })
            .expect("item should restore to pending");
        let restored_item = &restored.plans[0].items[0];
        assert_eq!(restored_item.state, CyclePlanItemState::Pending);
        assert_eq!(restored_item.completed_at, None);
        assert!(restored_item.updated_at > completed_item.updated_at);

        let original_completed_at = Some(1_700_000_123_456);
        let restored_completed = use_cases
            .restore_item_state(&RestoreCyclePlanItemStateInput {
                item_id: item.id,
                original_state: "completed".to_owned(),
                original_completed_at,
                original_skipped_at: None,
                expected_updated_at: restored_item.updated_at,
            })
            .expect("item should restore to the exact completed state");
        let restored_completed_item = &restored_completed.plans[0].items[0];
        assert_eq!(restored_completed_item.state, CyclePlanItemState::Completed);
        assert_eq!(restored_completed_item.completed_at, original_completed_at);
        assert!(restored_completed_item.updated_at > restored_item.updated_at);
    }

    #[test]
    fn skipped_transition_restore_and_shift_guards_are_atomic() {
        let directory = tempdir().expect("temporary directory should exist");
        let use_cases = use_cases(directory.path());
        let created = save_plan(&use_cases);
        let item = created.plans[0].items[0].clone();
        let preview_input = ShiftCyclePlanInput {
            plan_id: item.plan_id.clone(),
            from_date: item.planned_start_date.as_str().to_owned(),
            study_days: 1,
        };
        let preview = use_cases
            .preview_shift_plan(&preview_input)
            .expect("preview should succeed");
        let skipped = use_cases
            .set_item_state(&SetCyclePlanItemStateInput {
                item_id: item.id.clone(),
                target_state: "skipped".to_owned(),
                expected_updated_at: item.updated_at,
            })
            .expect("pending item should skip");
        let skipped_item = &skipped.dashboard.plans[0].items[0];
        assert_eq!(skipped_item.state, CyclePlanItemState::Skipped);
        assert_eq!(skipped_item.completed_at, None);
        assert!(skipped_item.skipped_at.is_some());
        assert_eq!(skipped.dashboard.plans[0].completed_count, 0);
        assert_eq!(skipped.dashboard.plans[0].skipped_count, 1);
        assert_eq!(skipped.dashboard.plans[0].progress_percent, 0);
        let error = use_cases
            .confirm_shift_plan(&ConfirmShiftCyclePlanInput {
                plan_id: preview_input.plan_id.clone(),
                from_date: preview_input.from_date.clone(),
                study_days: preview_input.study_days,
                preview_token: preview.preview_token.expect("preview should have token"),
            })
            .expect_err("skip must stale the prior preview");
        assert!(matches!(error, CyclePlanError::ShiftPreviewStale));
        let skipped_preview = use_cases
            .preview_shift_plan(&preview_input)
            .expect("skipped item preview should load");
        assert_eq!(skipped_preview.affected_item_count, 0);
        assert!(skipped_preview.preview_token.is_none());
        let error = use_cases
            .set_item_state(&SetCyclePlanItemStateInput {
                item_id: item.id.clone(),
                target_state: "skipped".to_owned(),
                expected_updated_at: skipped_item.updated_at,
            })
            .expect_err("same-state transition must fail");
        assert!(matches!(error, CyclePlanError::InvalidInput));
        let error = use_cases
            .set_item_state(&SetCyclePlanItemStateInput {
                item_id: item.id.clone(),
                target_state: "completed".to_owned(),
                expected_updated_at: skipped_item.updated_at,
            })
            .expect_err("terminal states must not transition directly");
        assert!(matches!(error, CyclePlanError::InvalidInput));

        let restored = use_cases
            .restore_item_state(&RestoreCyclePlanItemStateInput {
                item_id: item.id.clone(),
                original_state: "pending".to_owned(),
                original_completed_at: None,
                original_skipped_at: None,
                expected_updated_at: skipped_item.updated_at,
            })
            .expect("skip undo should restore pending");
        let restored_item = restored.plans[0].items[0].clone();
        assert_eq!(restored_item.state, CyclePlanItemState::Pending);
        assert_eq!(restored_item.skipped_at, None);
        let shifted = use_cases
            .shift_plan(&ShiftCyclePlanInput {
                plan_id: item.plan_id.clone(),
                from_date: restored_item.planned_start_date.as_str().to_owned(),
                study_days: 1,
            })
            .expect("pending item should shift");
        let undo = shifted.undo.expect("shift should return undo");
        let shifted_item = shifted.dashboard.plans[0].items[0].clone();
        use_cases
            .set_item_state(&SetCyclePlanItemStateInput {
                item_id: item.id,
                target_state: "skipped".to_owned(),
                expected_updated_at: shifted_item.updated_at,
            })
            .expect("shifted pending item should skip");
        let error = use_cases
            .undo_shift_plan(&UndoShiftCyclePlanInput {
                plan_id: undo.plan_id,
                undo_token: undo.undo_token,
            })
            .expect_err("skip must invalidate shift undo");
        assert!(matches!(error, CyclePlanError::ShiftUndoUnavailable));
    }

    #[test]
    fn save_refresh_and_shrink_preserve_skipped_terminal_item() {
        let directory = tempdir().expect("temporary directory should exist");
        let use_cases = use_cases(directory.path());
        let created = use_cases
            .save_plan(&SaveCyclePlanInput {
                plan_id: None,
                expected_updated_at: None,
                name: "skipped shrink cycle".to_owned(),
                total_units: 5,
                unit_label: "unit".to_owned(),
                start_date: "2026-07-29".to_owned(),
                deadline: "2026-12-31".to_owned(),
                study_days_per_unit: 1,
                schedule_mode: "rhythm".to_owned(),
                calendar_visible: true,
            })
            .expect("plan should save");
        let plan_id = created.plans[0].plan.id.clone();
        let fifth = created.plans[0].items[4].clone();
        let skipped = use_cases
            .set_item_state(&SetCyclePlanItemStateInput {
                item_id: fifth.id,
                target_state: "skipped".to_owned(),
                expected_updated_at: fifth.updated_at,
            })
            .expect("fifth item should skip");
        let skipped_item = skipped.dashboard.plans[0].items[4].clone();
        let saved = use_cases
            .save_plan(&SaveCyclePlanInput {
                plan_id: Some(plan_id.clone()),
                expected_updated_at: Some(skipped.dashboard.plans[0].plan.updated_at),
                name: "skipped preserved".to_owned(),
                total_units: 5,
                unit_label: "unit".to_owned(),
                start_date: "2026-07-29".to_owned(),
                deadline: "2026-12-31".to_owned(),
                study_days_per_unit: 1,
                schedule_mode: "rhythm".to_owned(),
                calendar_visible: true,
            })
            .expect("same-size save should preserve skipped item");
        assert_eq!(saved.plans[0].items[4], skipped_item);
        let refreshed = use_cases
            .refresh_schedules()
            .expect("refresh should preserve skipped item");
        assert_eq!(refreshed.plans[0].items[4], skipped_item);
        let error = use_cases
            .save_plan(&SaveCyclePlanInput {
                plan_id: Some(plan_id),
                expected_updated_at: Some(refreshed.plans[0].plan.updated_at),
                name: "illegal skipped shrink".to_owned(),
                total_units: 4,
                unit_label: "unit".to_owned(),
                start_date: "2026-07-29".to_owned(),
                deadline: "2026-12-31".to_owned(),
                study_days_per_unit: 1,
                schedule_mode: "rhythm".to_owned(),
                calendar_visible: true,
            })
            .expect_err("shrink below skipped terminal item must fail");
        assert!(matches!(error, CyclePlanError::CompletedProgressConflict));
    }

    #[test]
    fn stale_item_state_version_is_rejected_without_overwriting_the_item() {
        let directory = tempdir().expect("temporary directory should exist");
        let use_cases = use_cases(directory.path());
        let created = save_plan(&use_cases);
        let item = created.plans[0].items[0].clone();
        let completed = use_cases
            .set_item_state(&SetCyclePlanItemStateInput {
                item_id: item.id.clone(),
                target_state: "completed".to_owned(),
                expected_updated_at: item.updated_at,
            })
            .expect("item should complete");
        let completed_item = completed.dashboard.plans[0].items[0].clone();

        let error = use_cases
            .restore_item_state(&RestoreCyclePlanItemStateInput {
                item_id: item.id.clone(),
                original_state: "pending".to_owned(),
                original_completed_at: None,
                original_skipped_at: None,
                expected_updated_at: item.updated_at,
            })
            .expect_err("stale restore should be rejected");
        assert!(matches!(error, CyclePlanError::ItemStateStale));

        let unchanged = use_cases.dashboard().expect("dashboard should load");
        let unchanged_item = &unchanged.plans[0].items[0];
        assert_eq!(unchanged_item.state, completed_item.state);
        assert_eq!(unchanged_item.completed_at, completed_item.completed_at);
        assert_eq!(unchanged_item.updated_at, completed_item.updated_at);
    }

    #[test]
    fn missing_item_state_update_is_distinguished_from_stale_version() {
        let directory = tempdir().expect("temporary directory should exist");
        let use_cases = use_cases(directory.path());
        save_plan(&use_cases);

        let error = use_cases
            .set_item_state(&SetCyclePlanItemStateInput {
                item_id: "019f7328-4b66-7613-9729-e3570fc41525".to_owned(),
                target_state: "completed".to_owned(),
                expected_updated_at: 1_700_000_000_000,
            })
            .expect_err("missing item should be rejected");
        assert!(matches!(error, CyclePlanError::ItemNotFound));
    }
}
