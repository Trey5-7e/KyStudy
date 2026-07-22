use uuid::Uuid;

/// Latest database schema understood by this application build.
pub(crate) const LATEST_SCHEMA_VERSION: u32 = 8;

const DEFAULT_WORKSPACE_NAME: &str = "我的考研工作区";
const DEFAULT_TIMEZONE: &str = "Asia/Shanghai";
const DEFAULT_DAILY_REVIEW_QUOTA: u32 = 5;

/// Data required to create the first local workspace.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NewWorkspace {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) timezone: String,
    pub(crate) daily_review_quota: u32,
    pub(crate) early_fill_enabled: bool,
    pub(crate) created_at: i64,
}

impl NewWorkspace {
    /// Creates the product defaults with an offline, time-sortable identifier.
    pub(crate) fn default_at(created_at: i64) -> Self {
        Self {
            id: Uuid::now_v7().to_string(),
            name: DEFAULT_WORKSPACE_NAME.to_owned(),
            timezone: DEFAULT_TIMEZONE.to_owned(),
            daily_review_quota: DEFAULT_DAILY_REVIEW_QUOTA,
            early_fill_enabled: false,
            created_at,
        }
    }
}

/// Workspace metadata safe to return from the application layer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Workspace {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) timezone: String,
    pub(crate) daily_review_quota: u32,
    pub(crate) early_fill_enabled: bool,
    pub(crate) created_at: i64,
    pub(crate) schema_version: u32,
}

#[cfg(test)]
mod tests {
    use super::NewWorkspace;

    #[test]
    fn default_at_uses_the_initial_review_quota() {
        let workspace = NewWorkspace::default_at(1_700_000_000_000);

        assert_eq!(workspace.daily_review_quota, 5);
    }

    #[test]
    fn default_at_uses_an_offline_uuid_identifier() {
        let workspace = NewWorkspace::default_at(1_700_000_000_000);

        assert_eq!(workspace.id.len(), 36);
    }
}
