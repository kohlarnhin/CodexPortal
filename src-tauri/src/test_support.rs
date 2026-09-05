use crate::accounts::usage::{AccountUsage, AccountUsageWindow};
use chrono::DateTime;
use chrono::Utc;

pub(crate) fn utc_ts(iso: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(iso)
        .unwrap()
        .with_timezone(&Utc)
}

pub(crate) fn usage(used_percent: f64, resets_at: Option<i64>) -> AccountUsage {
    AccountUsage {
        request_started_at: None,
        primary: Some(AccountUsageWindow {
            used_percent,
            window_minutes: Some(300),
            resets_at,
        }),
        secondary: None,
        synced_at: "2026-08-07T10:00:00Z".to_string(),
        plan_type: None,
    }
}
