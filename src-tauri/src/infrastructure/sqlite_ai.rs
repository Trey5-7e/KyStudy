use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};

use crate::application::{
    AiCachedResponse, AiError, AiProviderResponse, AiRepository, BeginAiCall, default_provider,
};
use crate::domain::{
    AiBudget, AiCallSummary, AiModelProfile, AiProviderConfig, AiProviderType, AiUsageSummary,
};

use super::sqlite_workspace::{SqliteWorkspaceRepository, database_error, migrate, open_database};

#[derive(Debug, Clone)]
pub(crate) struct SqliteAiRepository {
    database_path: PathBuf,
}

impl SqliteAiRepository {
    pub(crate) fn new(application_data_directory: &Path) -> Self {
        let workspace = SqliteWorkspaceRepository::new(application_data_directory);
        Self {
            database_path: workspace.database_path(),
        }
    }

    fn open(&self) -> Result<Connection, AiError> {
        if !self.database_path.exists() {
            return Err(AiError::WorkspaceNotInitialized);
        }
        let mut connection = open_database(&self.database_path, false)?;
        migrate(&mut connection)?;
        Ok(connection)
    }
}

impl AiRepository for SqliteAiRepository {
    fn recover_pending(&self, finished_at: i64) -> Result<u64, AiError> {
        if !self.database_path.exists() {
            return Ok(0);
        }
        let connection = self.open()?;
        let changed = connection
            .execute(
                "UPDATE ai_call
                 SET state = 'failed', error_code = 'AI_CALL_INTERRUPTED', finished_at = ?1
                 WHERE state = 'pending'",
                [finished_at],
            )
            .map_err(database_error)?;
        u64::try_from(changed).map_err(|_| AiError::ProviderInvalidResponse)
    }

    fn ensure_defaults(&self, now: i64) -> Result<(), AiError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let workspace_id = transaction
            .query_row(
                "SELECT id FROM workspace WHERE singleton_key = 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(database_error)?
            .ok_or(AiError::WorkspaceNotInitialized)?;
        let exists = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM ai_provider_config WHERE workspace_id = ?1 AND enabled = 1)",
                [&workspace_id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(database_error)?;
        if exists {
            transaction
                .execute(
                    "INSERT INTO ai_budget(
                        workspace_id, single_call_limit, daily_token_limit,
                        monthly_token_limit, limit_mode, updated_at
                     ) VALUES (?1, 8000, 50000, 1000000, 'block', ?2)
                     ON CONFLICT(workspace_id) DO NOTHING",
                    params![workspace_id, now],
                )
                .map_err(database_error)?;
        } else {
            let (provider, model, budget) = default_provider(now);
            insert_provider(&transaction, &workspace_id, &provider, now)?;
            insert_model(&transaction, &model, now)?;
            insert_budget(&transaction, &workspace_id, &budget)?;
        }
        transaction.commit().map_err(database_error)?;
        Ok(())
    }

    fn load_configuration(&self) -> Result<(AiProviderConfig, AiModelProfile, AiBudget), AiError> {
        let connection = self.open()?;
        connection
            .query_row(
                "SELECT p.id, p.provider_type, p.display_name, p.base_url, p.secret_ref,
                        p.enabled, p.updated_at, m.id, m.model_name, m.context_limit,
                        m.max_output_tokens, m.updated_at, b.single_call_limit,
                        b.daily_token_limit, b.monthly_token_limit, b.limit_mode, b.updated_at
                 FROM ai_provider_config p
                 JOIN ai_model_profile m ON m.provider_config_id = p.id
                 JOIN ai_budget b ON b.workspace_id = p.workspace_id
                 WHERE p.enabled = 1",
                [],
                |row| {
                    let provider_type = row.get::<_, String>(1)?;
                    let provider_type = AiProviderType::parse(&provider_type)
                        .ok_or_else(|| rusqlite::Error::InvalidQuery)?;
                    Ok((
                        AiProviderConfig {
                            id: row.get(0)?,
                            provider_type,
                            display_name: row.get(2)?,
                            base_url: row.get(3)?,
                            secret_ref: row.get(4)?,
                            enabled: row.get(5)?,
                            updated_at: row.get(6)?,
                        },
                        AiModelProfile {
                            id: row.get(7)?,
                            provider_config_id: row.get(0)?,
                            model_name: row.get(8)?,
                            context_limit: read_u32(row, 9)?,
                            max_output_tokens: read_u32(row, 10)?,
                            updated_at: row.get(11)?,
                        },
                        AiBudget {
                            single_call_limit: read_u64(row, 12)?,
                            daily_token_limit: read_u64(row, 13)?,
                            monthly_token_limit: read_u64(row, 14)?,
                            limit_mode: row.get(15)?,
                            updated_at: row.get(16)?,
                        },
                    ))
                },
            )
            .optional()
            .map_err(database_error)?
            .ok_or(AiError::ConfigurationNotFound)
    }

    fn save_provider(
        &self,
        provider: &AiProviderConfig,
        model: &AiModelProfile,
    ) -> Result<(), AiError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let changed = transaction
            .execute(
                "UPDATE ai_provider_config
                 SET provider_type = ?2, display_name = ?3, base_url = ?4, secret_ref = ?5,
                     enabled = ?6, updated_at = ?7
                 WHERE id = ?1",
                params![
                    provider.id,
                    provider.provider_type.as_str(),
                    provider.display_name,
                    provider.base_url,
                    provider.secret_ref,
                    provider.enabled,
                    provider.updated_at,
                ],
            )
            .map_err(database_error)?;
        if changed != 1 {
            return Err(AiError::ConfigurationNotFound);
        }
        transaction
            .execute(
                "UPDATE ai_model_profile
                 SET model_name = ?2, context_limit = ?3, max_output_tokens = ?4, updated_at = ?5
                 WHERE id = ?1 AND provider_config_id = ?6",
                params![
                    model.id,
                    model.model_name,
                    i64::from(model.context_limit),
                    i64::from(model.max_output_tokens),
                    model.updated_at,
                    provider.id,
                ],
            )
            .map_err(database_error)?;
        transaction.commit().map_err(database_error)?;
        Ok(())
    }

    fn save_budget(&self, budget: &AiBudget) -> Result<(), AiError> {
        let connection = self.open()?;
        let changed = connection
            .execute(
                "UPDATE ai_budget
                 SET single_call_limit = ?1, daily_token_limit = ?2,
                     monthly_token_limit = ?3, limit_mode = ?4, updated_at = ?5
                 WHERE workspace_id = (SELECT id FROM workspace WHERE singleton_key = 1)",
                params![
                    to_i64(budget.single_call_limit)?,
                    to_i64(budget.daily_token_limit)?,
                    to_i64(budget.monthly_token_limit)?,
                    budget.limit_mode,
                    budget.updated_at,
                ],
            )
            .map_err(database_error)?;
        if changed == 1 {
            Ok(())
        } else {
            Err(AiError::ConfigurationNotFound)
        }
    }

    fn aggregate_usage(&self, day_start: i64, month_start: i64) -> Result<AiUsageSummary, AiError> {
        let connection = self.open()?;
        let (today, month) = connection
            .query_row(
                "SELECT
                    COALESCE(SUM(CASE WHEN c.started_at >= ?1 THEN u.input_tokens + u.output_tokens ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN c.started_at >= ?2 THEN u.input_tokens + u.output_tokens ELSE 0 END), 0)
                 FROM ai_usage u JOIN ai_call c ON c.id = u.ai_call_id",
                params![day_start, month_start],
                |row| Ok((read_u64(row, 0)?, read_u64(row, 1)?)),
            )
            .map_err(database_error)?;
        Ok(AiUsageSummary {
            today_tokens: today,
            month_tokens: month,
        })
    }

    fn list_calls(&self, limit: u32) -> Result<Vec<AiCallSummary>, AiError> {
        let connection = self.open()?;
        let mut statement = connection
            .prepare(
                "SELECT c.id, p.display_name, m.model_name, c.state, c.cache_hit,
                        COALESCE(u.input_tokens, 0), COALESCE(u.output_tokens, 0),
                        c.error_code, c.started_at, c.finished_at
                 FROM ai_call c
                 JOIN ai_provider_config p ON p.id = c.provider_config_id
                 JOIN ai_model_profile m ON m.id = c.model_profile_id
                 LEFT JOIN ai_usage u ON u.ai_call_id = c.id
                 ORDER BY c.started_at DESC, c.id DESC LIMIT ?1",
            )
            .map_err(database_error)?;
        let rows = statement
            .query_map([i64::from(limit)], |row| {
                Ok(AiCallSummary {
                    id: row.get(0)?,
                    provider_name: row.get(1)?,
                    model_name: row.get(2)?,
                    state: row.get(3)?,
                    cache_hit: row.get(4)?,
                    input_tokens: read_u64(row, 5)?,
                    output_tokens: read_u64(row, 6)?,
                    error_code: row.get(7)?,
                    started_at: row.get(8)?,
                    finished_at: row.get(9)?,
                })
            })
            .map_err(database_error)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(database_error)
            .map_err(AiError::from)
    }

    fn find_cache(&self, fingerprint: &str) -> Result<Option<AiCachedResponse>, AiError> {
        let connection = self.open()?;
        connection
            .query_row(
                "SELECT response_text FROM ai_response_cache WHERE request_fingerprint = ?1",
                [fingerprint],
                |row| Ok(AiCachedResponse { text: row.get(0)? }),
            )
            .optional()
            .map_err(database_error)
            .map_err(AiError::from)
    }

    fn begin_call(&self, call: &BeginAiCall) -> Result<(), AiError> {
        let connection = self.open()?;
        connection
            .execute(
                "INSERT INTO ai_call(
                    id, provider_config_id, model_profile_id, purpose, request_fingerprint,
                    state, input_token_estimate, output_token_limit, cache_hit, started_at
                 ) VALUES (?1, ?2, ?3, 'foundation_test', ?4, 'pending', ?5, ?6, ?7, ?8)",
                params![
                    call.id,
                    call.provider_id,
                    call.model_id,
                    call.request_fingerprint,
                    to_i64(call.input_token_estimate)?,
                    i64::from(call.output_token_limit),
                    call.cache_hit,
                    call.started_at,
                ],
            )
            .map_err(database_error)?;
        Ok(())
    }

    fn finish_call(
        &self,
        call_id: &str,
        fingerprint: &str,
        response: &AiProviderResponse,
        cache_hit: bool,
        finished_at: i64,
    ) -> Result<(), AiError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        transaction
            .execute(
                "UPDATE ai_call SET state = 'succeeded', finished_at = ?2 WHERE id = ?1 AND state = 'pending'",
                params![call_id, finished_at],
            )
            .map_err(database_error)?;
        transaction
            .execute(
                "INSERT INTO ai_usage(
                    ai_call_id, input_tokens, output_tokens, cached_input_tokens,
                    reasoning_tokens, usage_source
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    call_id,
                    to_i64(response.input_tokens)?,
                    to_i64(response.output_tokens)?,
                    to_i64(response.cached_input_tokens)?,
                    to_i64(response.reasoning_tokens)?,
                    response.usage_source,
                ],
            )
            .map_err(database_error)?;
        if cache_hit {
            transaction
                .execute(
                    "UPDATE ai_response_cache SET last_used_at = ?2 WHERE request_fingerprint = ?1",
                    params![fingerprint, finished_at],
                )
                .map_err(database_error)?;
        } else {
            transaction
                .execute(
                    "INSERT INTO ai_response_cache(
                        request_fingerprint, response_text, input_tokens, output_tokens,
                        cached_input_tokens, reasoning_tokens, created_at, last_used_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
                     ON CONFLICT(request_fingerprint) DO UPDATE SET
                        response_text = excluded.response_text,
                        input_tokens = excluded.input_tokens,
                        output_tokens = excluded.output_tokens,
                        cached_input_tokens = excluded.cached_input_tokens,
                        reasoning_tokens = excluded.reasoning_tokens,
                        last_used_at = excluded.last_used_at",
                    params![
                        fingerprint,
                        response.text,
                        to_i64(response.input_tokens)?,
                        to_i64(response.output_tokens)?,
                        to_i64(response.cached_input_tokens)?,
                        to_i64(response.reasoning_tokens)?,
                        finished_at,
                    ],
                )
                .map_err(database_error)?;
        }
        transaction.commit().map_err(database_error)?;
        Ok(())
    }

    fn fail_call(&self, call_id: &str, code: &str, finished_at: i64) -> Result<(), AiError> {
        let connection = self.open()?;
        connection
            .execute(
                "UPDATE ai_call
                 SET state = 'failed', error_code = ?2, finished_at = ?3
                 WHERE id = ?1 AND state = 'pending'",
                params![call_id, code, finished_at],
            )
            .map_err(database_error)?;
        Ok(())
    }
}

fn insert_provider(
    connection: &Connection,
    workspace_id: &str,
    provider: &AiProviderConfig,
    created_at: i64,
) -> Result<(), AiError> {
    connection
        .execute(
            "INSERT INTO ai_provider_config(
                id, workspace_id, provider_type, display_name, base_url, secret_ref,
                enabled, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                provider.id,
                workspace_id,
                provider.provider_type.as_str(),
                provider.display_name,
                provider.base_url,
                provider.secret_ref,
                provider.enabled,
                created_at,
                provider.updated_at,
            ],
        )
        .map_err(database_error)?;
    Ok(())
}

fn insert_model(
    connection: &Connection,
    model: &AiModelProfile,
    created_at: i64,
) -> Result<(), AiError> {
    connection
        .execute(
            "INSERT INTO ai_model_profile(
                id, provider_config_id, model_name, context_limit,
                max_output_tokens, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                model.id,
                model.provider_config_id,
                model.model_name,
                i64::from(model.context_limit),
                i64::from(model.max_output_tokens),
                created_at,
                model.updated_at,
            ],
        )
        .map_err(database_error)?;
    Ok(())
}

fn insert_budget(
    connection: &Connection,
    workspace_id: &str,
    budget: &AiBudget,
) -> Result<(), AiError> {
    connection
        .execute(
            "INSERT INTO ai_budget(
                workspace_id, single_call_limit, daily_token_limit,
                monthly_token_limit, limit_mode, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                workspace_id,
                to_i64(budget.single_call_limit)?,
                to_i64(budget.daily_token_limit)?,
                to_i64(budget.monthly_token_limit)?,
                budget.limit_mode,
                budget.updated_at,
            ],
        )
        .map_err(database_error)?;
    Ok(())
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

fn to_i64(value: u64) -> Result<i64, AiError> {
    i64::try_from(value).map_err(|_| AiError::InvalidInput)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex, PoisonError};

    use tempfile::tempdir;

    use super::SqliteAiRepository;
    use crate::application::{
        AiError, AiPreviewInput, AiRepository, AiUseCases, SaveAiBudgetInput, SecretStore,
        WorkspaceRepository,
    };
    use crate::domain::NewWorkspace;
    use crate::infrastructure::{ProviderRouter, SqliteWorkspaceRepository};

    #[derive(Debug, Clone, Default)]
    struct MemorySecretStore(Arc<Mutex<HashMap<String, String>>>);

    impl SecretStore for MemorySecretStore {
        fn has(&self, reference: &str) -> Result<bool, AiError> {
            Ok(self
                .0
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .contains_key(reference))
        }

        fn get(&self, reference: &str) -> Result<Option<String>, AiError> {
            Ok(self
                .0
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .get(reference)
                .cloned())
        }

        fn set(&self, reference: &str, secret: &str) -> Result<(), AiError> {
            self.0
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .insert(reference.to_owned(), secret.to_owned());
            Ok(())
        }

        fn delete(&self, reference: &str) -> Result<(), AiError> {
            self.0
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .remove(reference);
            Ok(())
        }
    }

    #[test]
    fn defaults_are_idempotent_and_exclude_a_secret() {
        let directory = tempdir().expect("temporary directory should exist");
        SqliteWorkspaceRepository::new(directory.path())
            .initialize_default(&NewWorkspace::default_at(1_700_000_000_000))
            .expect("workspace should initialize");
        let repository = SqliteAiRepository::new(directory.path());

        repository
            .ensure_defaults(1_700_000_000_001)
            .expect("defaults should initialize");
        repository
            .ensure_defaults(1_700_000_000_002)
            .expect("defaults should remain idempotent");
        let (provider, _, budget) = repository
            .load_configuration()
            .expect("configuration should load");

        assert_eq!(provider.secret_ref, None);
        assert_eq!(budget.limit_mode, "block");
    }

    #[test]
    fn offline_call_caches_without_new_usage_and_hard_budget_blocks() {
        let directory = tempdir().expect("temporary directory should exist");
        SqliteWorkspaceRepository::new(directory.path())
            .initialize_default(&NewWorkspace::default_at(1_700_000_000_000))
            .expect("workspace should initialize");
        let use_cases = AiUseCases::new(
            SqliteAiRepository::new(directory.path()),
            MemorySecretStore::default(),
            ProviderRouter,
        );
        let input = AiPreviewInput {
            prompt: "验证离线缓存".to_owned(),
            max_output_tokens: 100,
        };

        let first = use_cases
            .execute(&input)
            .expect("first call should execute");
        let usage_after_first = use_cases.overview().expect("overview should load").usage;
        let second = use_cases.execute(&input).expect("second call should cache");
        let usage_after_second = use_cases.overview().expect("overview should reload").usage;

        assert!(!first.cache_hit);
        assert!(second.cache_hit);
        assert_eq!(usage_after_first, usage_after_second);

        use_cases
            .save_budget(&SaveAiBudgetInput {
                single_call_limit: 1,
                daily_token_limit: 1,
                monthly_token_limit: 1,
                limit_mode: "block".to_owned(),
            })
            .expect("valid small budget should save");
        assert!(matches!(
            use_cases.execute(&AiPreviewInput {
                prompt: "新的未缓存请求".to_owned(),
                max_output_tokens: 1,
            }),
            Err(AiError::BudgetBlocked)
        ));
    }
}
