use std::path::Path;

use serde::Serialize;

use crate::domain::LATEST_SCHEMA_VERSION;

/// Non-sensitive runtime metadata exposed to the diagnostic UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeStatus {
    app_version: String,
    schema_version: u32,
    platform: String,
    architecture: String,
    build_profile: String,
    data_directory: String,
}

/// Builds runtime metadata without reading user files or mutable application state.
pub(crate) fn get_runtime_status(data_directory: &Path) -> RuntimeStatus {
    RuntimeStatus {
        app_version: env!("CARGO_PKG_VERSION").to_owned(),
        schema_version: LATEST_SCHEMA_VERSION,
        platform: std::env::consts::OS.to_owned(),
        architecture: std::env::consts::ARCH.to_owned(),
        build_profile: if cfg!(debug_assertions) {
            "debug".to_owned()
        } else {
            "release".to_owned()
        },
        data_directory: data_directory.to_string_lossy().into_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::get_runtime_status;
    use crate::domain::LATEST_SCHEMA_VERSION;
    use std::path::Path;

    fn runtime_status() -> super::RuntimeStatus {
        get_runtime_status(Path::new("C:\\KyStudy\\data"))
    }

    #[test]
    fn get_runtime_status_returns_current_application_version() {
        let status = runtime_status();

        assert_eq!(status.app_version, env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn get_runtime_status_reports_the_latest_supported_schema() {
        let status = runtime_status();

        assert_eq!(status.schema_version, LATEST_SCHEMA_VERSION);
    }

    #[test]
    fn get_runtime_status_reports_the_build_profile() {
        let status = runtime_status();

        assert_eq!(
            status.build_profile,
            if cfg!(debug_assertions) {
                "debug"
            } else {
                "release"
            }
        );
    }

    #[test]
    fn get_runtime_status_reports_the_resolved_data_directory() {
        assert_eq!(runtime_status().data_directory, r"C:\KyStudy\data");
    }
}
