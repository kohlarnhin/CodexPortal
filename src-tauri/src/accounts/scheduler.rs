use crate::accounts::get_accounts;
use crate::accounts::usage::{
    begin_account_refresh, persist_rotated_access_token, refresh_account_usage, AccountUsage,
};
use crate::auth::{exchange_rt_for_at, extract_personal_access_token, resolve_token_metadata};
use crate::codex::version::sync_codex_version;
use crate::state::AppState;
use chrono::DateTime;
use chrono::Utc;
use rusqlite::params;
use std::collections::HashMap;
use std::collections::HashSet;
use std::thread;
use std::time::Duration;
use tauri::Manager;

/// 每个账号之间的刷新间隔（重启全量刷新时逐个执行）。
const USAGE_REFRESH_BATCH_SLEEP_SECONDS: u64 = 60;

/// Access Token 续期检查间隔。
const ACCESS_TOKEN_CHECK_INTERVAL_SECONDS: i64 = 300;

/// 第一个周期重置后留出一分钟等待服务端更新；失败后每 5 分钟重试，最多 3 次。
const USAGE_RESET_GRACE_SECONDS: i64 = 60;

const USAGE_RESET_CHECK_INTERVAL_SECONDS: u64 = 30;

const USAGE_RESET_RETRY_SECONDS: i64 = 300;

const USAGE_RESET_MAX_RETRIES: u8 = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum UsageResetRefreshState {
    Complete,
    Exhausted,
    RetryAt {
        retry_at: DateTime<Utc>,
        failures: u8,
    },
}

impl UsageResetRefreshState {
    fn is_due(self, now: DateTime<Utc>) -> bool {
        match self {
            Self::RetryAt { retry_at, .. } => retry_at <= now,
            Self::Complete | Self::Exhausted => false,
        }
    }

    fn after_failure(previous: Option<Self>, now: DateTime<Utc>) -> Self {
        let failures = match previous {
            Some(Self::RetryAt { failures, .. }) => failures + 1,
            Some(finished) => return finished,
            None => 1,
        };
        if failures > USAGE_RESET_MAX_RETRIES {
            Self::Exhausted
        } else {
            Self::RetryAt {
                retry_at: now + chrono::Duration::seconds(USAGE_RESET_RETRY_SECONDS),
                failures,
            }
        }
    }
}

/// 只按第一个周期（primary）的重置时间刷新，不以 secondary 作为触发或兜底。
/// 会话返回的额度也参与判断；剩余百分比未用尽时同样刷新。
fn pending_primary_reset_time(usage: &AccountUsage, now: DateTime<Utc>) -> Option<i64> {
    let resets_at = usage
        .primary
        .as_ref()?
        .resets_at
        .filter(|value| *value > 0)?;
    let due_at = DateTime::from_timestamp(resets_at, 0)?
        .checked_add_signed(chrono::Duration::seconds(USAGE_RESET_GRACE_SECONDS))?;
    let last_request = usage
        .request_started_at
        .as_deref()
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|time| time.with_timezone(&Utc));
    (due_at <= now && last_request.map(|request| request < due_at).unwrap_or(true))
        .then_some(resets_at)
}

/// 启动时回填历史账号的 whoami 元数据（订阅类型、账号 ID、FedRAMP）。
/// 针对 `chatgpt_plan_type` 缺失的账号，用其 PAT 调 whoami 并更新。
fn backfill_account_metadata(state: &AppState) {
    let targets: Vec<(String, String)> = {
        let Ok(db) = state.db.lock() else {
            return;
        };
        let Ok(mut stmt) = db
            .prepare("SELECT id, auth_json_content FROM accounts WHERE chatgpt_plan_type IS NULL")
        else {
            return;
        };
        let Ok(rows) = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }) else {
            return;
        };
        let mut targets = Vec::new();
        for row in rows.flatten() {
            let (id, auth_json_content) = row;
            if let Some(token) = extract_personal_access_token(&auth_json_content) {
                targets.push((id, token));
            }
        }
        targets
    };

    for (id, token) in targets {
        match resolve_token_metadata(&token) {
            Ok(meta) => {
                let Ok(db) = state.db.lock() else {
                    continue;
                };
                let _ = db.execute(
                    "UPDATE accounts SET chatgpt_plan_type = ?1, chatgpt_account_id = ?2, chatgpt_account_is_fedramp = ?3 WHERE id = ?4",
                    params![meta.chatgpt_plan_type, meta.chatgpt_account_id, meta.chatgpt_account_is_fedramp as i32, id],
                );
            }
            Err(error) => {
                eprintln!("[backfill] {id} 元数据回填失败: {error}");
            }
        }
    }
}

/// 刷新所有 at 临近过期的 rt 账号的 access token（rt 一次性使用，保存新 rt）。
fn refresh_due_access_tokens(state: &AppState) {
    let targets: Vec<(String, String)> = {
        let Ok(db) = state.db.lock() else {
            return;
        };
        let cutoff = (Utc::now() + chrono::Duration::minutes(5)).to_rfc3339();
        let Ok(mut stmt) = db.prepare(
            "SELECT id, refresh_token FROM accounts WHERE refresh_token IS NOT NULL AND at_expires_at IS NOT NULL AND at_expires_at <= ?1",
        ) else {
            return;
        };
        let Ok(rows) = stmt.query_map(params![cutoff], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }) else {
            return;
        };
        rows.flatten().collect()
    };

    for (id, rt) in targets {
        let Ok(_guard) = begin_account_refresh(state, &id, None) else {
            continue;
        };
        // 等待互斥期间凭证可能已更新，丢弃旧候选。
        let still_current = state
            .db
            .lock()
            .ok()
            .and_then(|db| {
                db.query_row(
                    "SELECT refresh_token = ?1 FROM accounts WHERE id = ?2",
                    params![rt, id],
                    |row| row.get::<_, bool>(0),
                )
                .ok()
            })
            .unwrap_or(false);
        if !still_current {
            continue;
        }
        match exchange_rt_for_at(&rt) {
            Ok(info) => {
                let saved = state
                    .db
                    .lock()
                    .map_err(|e| e.to_string())
                    .and_then(|db| persist_rotated_access_token(&db, &id, &rt, &info));
                if let Err(error) = saved {
                    eprintln!("[at-refresh] {id} 保存失败: {error}");
                    continue;
                }
                eprintln!("[at-refresh] {id} 已刷新");
            }
            Err(error) => {
                eprintln!("[at-refresh] {id} 刷新失败: {error}");
            }
        }
    }
}

/// 启动时补刷到期账号；运行期间按 primary 的重置时间主动刷新，同时维护 Access Token。
/// 会话每 5 分钟同步独立运行；每次重置最多首次请求 + 3 次重试，成功或耗尽后停止。
pub(crate) fn start_usage_scheduler(app: tauri::AppHandle) {
    thread::spawn(move || {
        {
            let state = app.state::<AppState>();
            sync_codex_version(&*state);
            backfill_account_metadata(&*state);
        }

        let startup_at = Utc::now();
        let mut startup_due: HashSet<String> = get_accounts(app.state::<AppState>())
            .map(|store| {
                store
                    .accounts
                    .into_iter()
                    .filter(|account| {
                        account.can_refresh_usage
                            && account
                                .next_refresh_at
                                .as_deref()
                                .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
                                .map(|time| time.with_timezone(&Utc) <= startup_at)
                                .unwrap_or(true)
                    })
                    .map(|account| account.id)
                    .collect()
            })
            .unwrap_or_default();
        let mut reset_states: HashMap<(String, i64), UsageResetRefreshState> = HashMap::new();
        let mut next_usage_request_at = startup_at;
        let mut next_access_check_at = startup_at;

        loop {
            let now = Utc::now();
            if now >= next_usage_request_at {
                if let Ok(store) = get_accounts(app.state::<AppState>()) {
                    let state = app.state::<AppState>();
                    let refreshing = state
                        .refreshing
                        .lock()
                        .map(|ids| ids.clone())
                        .unwrap_or_default();
                    let mut known_resets = HashSet::new();
                    for account in &store.accounts {
                        if let Some(reset) = account
                            .usage
                            .as_ref()
                            .and_then(|usage| usage.primary.as_ref())
                            .and_then(|window| window.resets_at)
                        {
                            known_resets.insert((account.id.clone(), reset));
                        }
                    }
                    reset_states.retain(|key, _| known_resets.contains(key));
                    // 手动刷新可能已处理启动队列，重新读取计划，避免重复刷新。
                    startup_due.retain(|id| {
                        store.accounts.iter().any(|account| {
                            &account.id == id
                                && account.can_refresh_usage
                                && account
                                    .next_refresh_at
                                    .as_deref()
                                    .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
                                    .map(|time| time.with_timezone(&Utc) <= now)
                                    .unwrap_or(true)
                        })
                    });

                    // get_accounts 按活跃账号优先排序；到重置时间的账号优先于启动补刷队列。
                    let reset_target = store
                        .accounts
                        .iter()
                        .filter(|account| {
                            account.can_refresh_usage && !refreshing.contains(&account.id)
                        })
                        .find_map(|account| {
                            let reset = pending_primary_reset_time(account.usage.as_ref()?, now)?;
                            let due = reset_states
                                .get(&(account.id.clone(), reset))
                                .map(|status| status.is_due(now))
                                .unwrap_or(true);
                            due.then(|| (account.id.clone(), Some(reset)))
                        });
                    let target = reset_target.or_else(|| {
                        store
                            .accounts
                            .iter()
                            .find(|account| {
                                startup_due.contains(&account.id)
                                    && !refreshing.contains(&account.id)
                            })
                            .map(|account| (account.id.clone(), None))
                    });

                    if let Some((id, reset)) = target {
                        let result = tauri::async_runtime::block_on(refresh_account_usage(
                            app.clone(),
                            app.state::<AppState>(),
                            id.clone(),
                        ));
                        let finished_at = Utc::now();
                        if let Err(error) = &result {
                            eprintln!("[usage-scheduler] 刷新失败 {id}: {error}");
                        }
                        if let Some(reset) = reset {
                            let key = (id.clone(), reset);
                            let confirmed = result
                                .as_ref()
                                .map(|usage| {
                                    pending_primary_reset_time(usage, finished_at) != Some(reset)
                                })
                                .unwrap_or(false);
                            let status = if confirmed {
                                UsageResetRefreshState::Complete
                            } else {
                                // 会话更新覆盖了本次响应时，也受同一重试次数上限约束。
                                UsageResetRefreshState::after_failure(
                                    reset_states.get(&key).copied(),
                                    finished_at,
                                )
                            };
                            reset_states.insert(key, status);
                        }
                        startup_due.remove(&id);
                        next_usage_request_at = finished_at
                            + chrono::Duration::seconds(USAGE_REFRESH_BATCH_SLEEP_SECONDS as i64);
                    }
                }
            }

            if Utc::now() >= next_access_check_at {
                refresh_due_access_tokens(&*app.state::<AppState>());
                next_access_check_at =
                    Utc::now() + chrono::Duration::seconds(ACCESS_TOKEN_CHECK_INTERVAL_SECONDS);
            }
            thread::sleep(Duration::from_secs(USAGE_RESET_CHECK_INTERVAL_SECONDS));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::accounts::usage::AccountUsageWindow;
    use crate::test_support::{usage, utc_ts};

    #[test]
    fn reset_refresh_waits_for_grace_even_when_quota_is_not_exhausted() {
        let reset = utc_ts("2026-08-07T10:00:00Z");
        let usage = usage(40.0, Some(reset.timestamp()));
        assert!(pending_primary_reset_time(&usage, reset).is_none());
        assert!(
            pending_primary_reset_time(&usage, reset + chrono::Duration::seconds(59)).is_none()
        );
        assert_eq!(
            pending_primary_reset_time(&usage, reset + chrono::Duration::seconds(60)),
            Some(reset.timestamp()),
        );
    }

    #[test]
    fn reset_refresh_ignores_secondary_even_when_primary_is_missing() {
        let reset = utc_ts("2026-08-07T10:00:00Z");
        let now = reset + chrono::Duration::seconds(60);
        for minutes in [10_080, 43_200] {
            let mut usage = usage(20.0, Some(reset.timestamp() + 3600));
            usage.secondary = Some(AccountUsageWindow {
                used_percent: 60.0,
                window_minutes: Some(minutes),
                resets_at: Some(reset.timestamp()),
            });
            assert!(pending_primary_reset_time(&usage, now).is_none());
            usage.primary.as_mut().unwrap().resets_at = None;
            assert!(pending_primary_reset_time(&usage, now).is_none());
            usage.primary = None;
            assert!(pending_primary_reset_time(&usage, now).is_none());
        }
    }

    #[test]
    fn reset_refresh_requires_a_request_started_after_the_grace_period() {
        let reset = utc_ts("2026-08-07T10:00:00Z");
        let mut usage = usage(100.0, Some(reset.timestamp()));
        usage.synced_at = "2026-08-07T10:02:00Z".to_string();
        usage.request_started_at = Some("2026-08-07T10:00:59Z".to_string());
        let now = utc_ts("2026-08-07T10:03:00Z");
        assert_eq!(
            pending_primary_reset_time(&usage, now),
            Some(reset.timestamp())
        );
        usage.request_started_at = Some("2026-08-07T10:01:00Z".to_string());
        assert!(pending_primary_reset_time(&usage, now).is_none());

        // 第二个周期随后到期不会触发额外刷新。
        usage.secondary = Some(AccountUsageWindow {
            used_percent: 50.0,
            window_minutes: Some(10_080),
            resets_at: Some(reset.timestamp() + 120),
        });
        assert!(pending_primary_reset_time(&usage, now).is_none());
        usage.primary.as_mut().unwrap().resets_at = Some(reset.timestamp() + 120);
        assert_eq!(
            pending_primary_reset_time(&usage, now),
            Some(reset.timestamp() + 120)
        );
    }

    #[test]
    fn reset_refresh_ignores_missing_or_invalid_reset_times() {
        let now = utc_ts("2026-08-07T10:00:00Z");
        for reset in [None, Some(0), Some(-1), Some(i64::MAX)] {
            assert!(pending_primary_reset_time(&usage(100.0, reset), now).is_none());
        }
    }

    #[test]
    fn reset_refresh_stops_after_initial_failure_and_three_retries() {
        let mut now = utc_ts("2026-08-07T10:01:00Z");
        let mut previous = None;
        for failures in 1..=3 {
            let status = UsageResetRefreshState::after_failure(previous, now);
            let retry_at = now + chrono::Duration::minutes(5);
            assert_eq!(
                status,
                UsageResetRefreshState::RetryAt { retry_at, failures }
            );
            assert!(!status.is_due(retry_at - chrono::Duration::seconds(1)));
            assert!(status.is_due(retry_at));
            previous = Some(status);
            now = retry_at;
        }
        // 首次请求失败 + 三次重试失败，此周期到此停止。
        let stopped = UsageResetRefreshState::after_failure(previous, now);
        assert_eq!(stopped, UsageResetRefreshState::Exhausted);
        assert!(!stopped.is_due(now + chrono::Duration::days(1)));
        assert_eq!(
            UsageResetRefreshState::after_failure(Some(stopped), now),
            stopped
        );
    }

    #[test]
    fn reset_refresh_stops_immediately_after_success() {
        let now = utc_ts("2026-08-07T10:01:00Z");
        let complete = UsageResetRefreshState::Complete;
        assert!(!complete.is_due(now + chrono::Duration::days(1)));
        assert_eq!(
            UsageResetRefreshState::after_failure(Some(complete), now),
            complete
        );
    }
}
