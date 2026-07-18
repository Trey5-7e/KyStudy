use std::time::{SystemTime, UNIX_EPOCH};

use crate::{DatabaseError, Result};

pub(crate) fn now_utc_millis() -> Result<i64> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| DatabaseError::InvalidSystemTime)?;

    i64::try_from(duration.as_millis()).map_err(|_| DatabaseError::InvalidSystemTime)
}
