use chrono::DateTime;

pub(crate) fn rfc3339_timestamp_millis(timestamp: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|time| time.timestamp_millis())
}

pub(crate) fn timestamp_is_not_after(candidate: &str, previous: &str) -> bool {
    match (
        DateTime::parse_from_rfc3339(candidate),
        DateTime::parse_from_rfc3339(previous),
    ) {
        (Ok(candidate), Ok(previous)) => candidate <= previous,
        _ => candidate <= previous,
    }
}

/// UTC RFC3339 时间戳 → 本地时区日期（YYYY-MM-DD）。
pub(crate) fn utc_ts_to_local_date(ts: &str) -> Option<String> {
    let local = DateTime::parse_from_rfc3339(ts)
        .ok()?
        .with_timezone(&chrono::Local);
    Some(local.format("%Y-%m-%d").to_string())
}
