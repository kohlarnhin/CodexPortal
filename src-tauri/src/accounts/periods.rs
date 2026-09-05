use crate::auth::extract_personal_access_token;
use crate::state::AppState;
use crate::time::rfc3339_timestamp_millis;
use chrono::Utc;
use rusqlite::params;
use rusqlite::Connection;

/// 确保当前活跃账号存在一条进行中时段（懒创建，幂等）：
/// 若账号库有活跃账号且其没有进行中时段，则补开一条（started_at = 当前时刻）。
/// 返回活跃账号 id（无活跃账号返回 None）；补段失败返回错误。
pub(crate) fn ensure_active_account_period(conn: &Connection) -> Result<Option<String>, String> {
    let active_id: Option<String> = conn
        .query_row("SELECT id FROM accounts WHERE is_active = 1", [], |row| {
            row.get(0)
        })
        .ok();
    let Some(active_id) = active_id else {
        return Ok(None);
    };
    let has_open: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM account_active_periods WHERE account_id = ?1 AND ended_at IS NULL",
            params![active_id],
            |row| row.get(0),
        )
        .unwrap_or(0);
    if has_open == 0 {
        conn.execute(
            "INSERT INTO account_active_periods (account_id, started_at) VALUES (?1, ?2)",
            params![active_id, Utc::now().to_rfc3339()],
        )
        .map_err(|e| format!("为活跃账号补开时段失败：{e}"))?;
    }
    Ok(Some(active_id))
}

/// 应用启动时整理账号活跃时段：
/// - 上次进行中的时段与当前活跃账号相同 → 直接续接；
/// - 不同或无进行中时段 → 关闭旧段并给当前账号开新段。
/// 活跃时段用于把会话返回的剩余额度归属到对应账号。
pub(crate) fn ensure_account_period(conn: &Connection, active_id: Option<&str>, now: &str) {
    let last_open: Option<(i64, String)> = conn
        .query_row(
            "SELECT id, account_id FROM account_active_periods WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1",
            [],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )
        .ok();

    // 上次进行中的就是当前账号 → 续接该段；否则全部关闭并开新段。
    let keep_id: Option<i64> = match (&last_open, active_id) {
        (Some((id, account)), Some(active)) if account == active => Some(*id),
        _ => None,
    };

    match keep_id {
        Some(id) => {
            let _ = conn.execute(
                "UPDATE account_active_periods SET ended_at = ?1 WHERE ended_at IS NULL AND id != ?2",
                params![now, id],
            );
        }
        None => {
            let _ = conn.execute(
                "UPDATE account_active_periods SET ended_at = ?1 WHERE ended_at IS NULL",
                params![now],
            );
            if let Some(active_id) = active_id {
                let _ = conn.execute(
                    "INSERT INTO account_active_periods (account_id, started_at) VALUES (?1, ?2)",
                    params![active_id, now],
                );
            }
        }
    }
}

pub(crate) fn ensure_account_period_on_startup(state: &AppState) {
    let Ok(db) = state.db.lock() else {
        return;
    };
    let active: Option<(String, String)> = db
        .query_row(
            "SELECT id, auth_json_content FROM accounts WHERE is_active = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok();
    let active_id = active.and_then(|(id, content)| {
        if extract_personal_access_token(&content).is_some() {
            Some(id)
        } else {
            let _ = db.execute(
                "UPDATE accounts SET is_active = 0 WHERE id = ?1",
                params![id],
            );
            None
        }
    });
    ensure_account_period(&db, active_id.as_deref(), &Utc::now().to_rfc3339());
}

/// 账号活跃时段（解析会话时用于把剩余额度归属到账号）。
#[derive(Debug, Clone)]
pub(crate) struct ActivePeriod {
    pub(crate) account_id: String,
    pub(crate) started_millis: i64,
    pub(crate) ended_millis: Option<i64>,
}

/// 加载全部账号活跃时段（会话剩余额度按账号归属用）。
pub(crate) fn load_active_periods(db: &Connection) -> Vec<ActivePeriod> {
    let Ok(mut stmt) = db.prepare(
        "SELECT account_id, started_at, ended_at FROM account_active_periods ORDER BY started_at",
    ) else {
        return Vec::new();
    };
    let Ok(rows) = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
        ))
    }) else {
        return Vec::new();
    };
    let mut periods = Vec::new();
    for row in rows.flatten() {
        let Some(started_millis) = rfc3339_timestamp_millis(&row.1) else {
            continue;
        };
        let ended_millis = match row.2.as_deref() {
            Some(value) => match rfc3339_timestamp_millis(value) {
                Some(end) if end >= started_millis => Some(end),
                _ => continue,
            },
            None => None,
        };
        periods.push(ActivePeriod {
            account_id: row.0,
            started_millis,
            ended_millis,
        });
    }
    periods
}

/// 查找包含指定时刻（Unix 毫秒）的账号活跃时段；无匹配返回 None。
/// 时段为半开区间 [start, end)：切换时刻（ended_at = 切换时间）归新账号。
pub(crate) fn active_period_account(periods: &[ActivePeriod], ts_millis: i64) -> Option<String> {
    let mut matching = periods.iter().filter(|period| {
        ts_millis >= period.started_millis
            && period
                .ended_millis
                .map(|end| ts_millis < end)
                .unwrap_or(true)
    });
    let first = matching.next()?;
    if matching.any(|other| other.account_id != first.account_id) {
        return None;
    }
    Some(first.account_id.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_period_account_matches_containing_period() {
        let periods = vec![
            ActivePeriod {
                account_id: "acc-a".to_string(),
                started_millis: 1_000,
                ended_millis: Some(2_000),
            },
            ActivePeriod {
                account_id: "acc-b".to_string(),
                started_millis: 2_000,
                ended_millis: None, // 进行中
            },
        ];
        assert_eq!(active_period_account(&periods, 999), None);
        assert_eq!(
            active_period_account(&periods, 1_500).as_deref(),
            Some("acc-a")
        );
        assert_eq!(
            active_period_account(&periods, 2_000).as_deref(),
            Some("acc-b")
        );
        assert_eq!(
            active_period_account(&periods, 9_999).as_deref(),
            Some("acc-b")
        );
        assert_eq!(active_period_account(&[], 1_500), None);
    }

    /// 构造带 account_active_periods 表的内存库。
    fn period_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE account_active_periods (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id TEXT NOT NULL,
                started_at TEXT NOT NULL,
                ended_at TEXT
            )",
        )
        .unwrap();
        conn
    }

    fn open_periods(conn: &Connection) -> Vec<(String, Option<String>)> {
        let mut stmt = conn
            .prepare("SELECT account_id, ended_at FROM account_active_periods ORDER BY id")
            .unwrap();
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
            })
            .unwrap();
        rows.flatten().collect()
    }

    #[test]
    fn ensure_active_account_period_is_idempotent() {
        let conn = period_test_db();
        conn.execute_batch(
            "CREATE TABLE accounts (id TEXT PRIMARY KEY, is_active INTEGER NOT NULL DEFAULT 0)",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO accounts (id, is_active) VALUES ('acc-a', 1)",
            [],
        )
        .unwrap();

        // 无段 → 补开一条。
        let active = ensure_active_account_period(&conn).unwrap();
        assert_eq!(active.as_deref(), Some("acc-a"));
        let periods = open_periods(&conn);
        assert_eq!(periods.len(), 1);
        assert!(periods[0].1.is_none(), "补开的段应为进行中");

        // 再次调用 → 幂等，不再新增。
        let active = ensure_active_account_period(&conn).unwrap();
        assert_eq!(active.as_deref(), Some("acc-a"));
        assert_eq!(open_periods(&conn).len(), 1);

        // 无活跃账号 → None，且不开段。
        conn.execute("UPDATE accounts SET is_active = 0", [])
            .unwrap();
        assert!(ensure_active_account_period(&conn).unwrap().is_none());
        assert_eq!(open_periods(&conn).len(), 1, "无活跃账号时不应新增时段");
    }

    #[test]
    fn startup_continues_same_account_period() {
        let conn = period_test_db();
        conn.execute(
            "INSERT INTO account_active_periods (account_id, started_at) VALUES ('acc-a', '2026-08-13T10:00:00Z')",
            [],
        )
        .unwrap();
        // 上次进行中的段就是当前账号 → 续接，不关闭、不开新段。
        ensure_account_period(&conn, Some("acc-a"), "2026-08-14T09:00:00Z");
        let periods = open_periods(&conn);
        assert_eq!(periods.len(), 1);
        assert_eq!(periods[0].0, "acc-a");
        assert!(periods[0].1.is_none(), "同账号应续接原时段，保持进行中");
    }

    #[test]
    fn startup_closes_other_account_and_opens_new() {
        let conn = period_test_db();
        conn.execute(
            "INSERT INTO account_active_periods (account_id, started_at) VALUES ('acc-a', '2026-08-13T10:00:00Z')",
            [],
        )
        .unwrap();
        // 上次进行中的是 A，当前活跃是 B → 关闭 A 段 + 开 B 段。
        ensure_account_period(&conn, Some("acc-b"), "2026-08-14T09:00:00Z");
        let periods = open_periods(&conn);
        assert_eq!(periods.len(), 2);
        assert_eq!(periods[0].0, "acc-a");
        assert_eq!(
            periods[0].1.as_deref(),
            Some("2026-08-14T09:00:00Z"),
            "旧账号段应在启动时刻关闭"
        );
        assert_eq!(periods[1].0, "acc-b");
        assert!(periods[1].1.is_none());
    }

    #[test]
    fn startup_without_active_account_closes_all() {
        let conn = period_test_db();
        conn.execute(
            "INSERT INTO account_active_periods (account_id, started_at) VALUES ('acc-a', '2026-08-13T10:00:00Z')",
            [],
        )
        .unwrap();
        ensure_account_period(&conn, None, "2026-08-14T09:00:00Z");
        let periods = open_periods(&conn);
        assert_eq!(periods.len(), 1);
        assert!(periods[0].1.is_some(), "无活跃账号时应关闭进行中时段");
    }
}
