use crate::state::AppState;
use chrono::{DateTime, Duration, Local, NaiveTime, TimeZone, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};

const QUOTA_QUIET_HOURS_KEY: &str = "quota_quiet_hours";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QuotaQuietHours {
    enabled: bool,
    start_time: String,
    end_time: String,
}

impl Default for QuotaQuietHours {
    fn default() -> Self {
        Self {
            enabled: true,
            start_time: "19:00".to_string(),
            end_time: "09:00".to_string(),
        }
    }
}

impl QuotaQuietHours {
    fn times(&self) -> Result<(NaiveTime, NaiveTime), String> {
        let parse = |value: &str| {
            NaiveTime::parse_from_str(value, "%H:%M")
                .ok()
                .filter(|time| time.format("%H:%M").to_string() == value)
                .ok_or_else(|| "免打扰时间格式应为 HH:mm".to_string())
        };
        let start = parse(&self.start_time)?;
        let end = parse(&self.end_time)?;
        if start == end {
            return Err("免打扰开始时间和结束时间不能相同".to_string());
        }
        Ok((start, end))
    }

    fn resume_at(&self, now: DateTime<Utc>) -> Result<Option<DateTime<Utc>>, String> {
        if !self.enabled {
            return Ok(None);
        }
        let (start, end) = self.times()?;
        let local_now = now.with_timezone(&Local);
        let time = local_now.time();
        let mut end_date = local_now.date_naive();
        if start < end {
            if time < start || time >= end {
                return Ok(None);
            }
        } else if time >= start {
            end_date = end_date
                .succ_opt()
                .ok_or_else(|| "无法计算免打扰结束日期".to_string())?;
        } else if time >= end {
            return Ok(None);
        }

        let end_at = Local
            .from_local_datetime(&end_date.and_time(end))
            .latest()
            .ok_or_else(|| "当前时区下的免打扰结束时间无效".to_string())?;
        Ok(Some(end_at.with_timezone(&Utc) + Duration::minutes(1)))
    }
}

fn read_quiet_hours(db: &Connection) -> Result<QuotaQuietHours, String> {
    let content: Option<String> = db
        .query_row(
            "SELECT content FROM configs WHERE key = ?1",
            params![QUOTA_QUIET_HOURS_KEY],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    match content {
        Some(content) => serde_json::from_str(&content).map_err(|error| error.to_string()),
        None => Ok(QuotaQuietHours::default()),
    }
}

#[tauri::command]
pub(crate) fn get_quota_quiet_hours(state: State<'_, AppState>) -> Result<QuotaQuietHours, String> {
    let db = state.db.lock().map_err(|error| error.to_string())?;
    read_quiet_hours(&db)
}

#[tauri::command]
pub(crate) fn set_quota_quiet_hours(
    state: State<'_, AppState>,
    settings: QuotaQuietHours,
) -> Result<(), String> {
    settings.times()?;
    let content = serde_json::to_string(&settings).map_err(|error| error.to_string())?;
    let db = state.db.lock().map_err(|error| error.to_string())?;
    db.execute(
        "INSERT INTO configs (key, content) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET content = ?2",
        params![QUOTA_QUIET_HOURS_KEY, content],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

/// 仅在有账号到期时调用，免打扰期间统一调整所有账号的下次刷新时间。
pub(crate) fn defer_usage_during_quiet_hours(
    app: &tauri::AppHandle,
    state: &AppState,
    now: DateTime<Utc>,
) -> Result<bool, String> {
    let db = state.db.lock().map_err(|error| error.to_string())?;
    let settings = read_quiet_hours(&db)?;
    let Some(resume_at) = settings.resume_at(now)? else {
        return Ok(false);
    };
    db.execute(
        "UPDATE accounts SET next_refresh_at = ?1",
        params![resume_at.to_rfc3339()],
    )
    .map_err(|error| error.to_string())?;
    drop(db);
    let _ = app.emit("accounts-updated", ());
    Ok(true)
}
