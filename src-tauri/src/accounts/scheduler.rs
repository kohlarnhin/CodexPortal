use crate::accounts::get_accounts;
use crate::accounts::messages::send_test_message;
use crate::accounts::quiet_hours::defer_usage_during_quiet_hours;
use crate::accounts::usage::{
    begin_account_refresh, save_fallback_reset, persist_rotated_access_token,
    refresh_account_usage,
};
use crate::auth::{exchange_rt_for_at, extract_personal_access_token, resolve_token_metadata};
use crate::codex::version::sync_codex_version;
use crate::state::AppState;
use chrono::{DateTime, Utc};
use rusqlite::params;
use std::thread;
use std::time::Duration;
use tauri::Manager;

/// 自动请求逐账号执行，相邻请求至少间隔一分钟。
const USAGE_REFRESH_BATCH_SLEEP_SECONDS: i64 = 60;
const ACCESS_TOKEN_CHECK_INTERVAL_SECONDS: i64 = 300;
const USAGE_CHECK_INTERVAL_SECONDS: u64 = 30;

/// 启动时回填历史账号的 whoami 元数据（订阅类型、账号 ID、FedRAMP）。
/// 针对 `chatgpt_plan_type` 缺失的账号，用其 PAT 调 whoami 并更新。
fn backfill_account_metadata(app: &tauri::AppHandle, state: &AppState) {
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
                save_fallback_reset(app, state, &id, "账号信息获取失败", &error);
            }
        }
    }
}

/// 刷新所有 at 临近过期的 rt 账号的 access token（rt 一次性使用，保存新 rt）。
fn refresh_due_access_tokens(app: &tauri::AppHandle, state: &AppState) {
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
                    save_fallback_reset(app, state, &id, "账号认证续期失败", &error);
                    continue;
                }
            }
            Err(error) => {
                save_fallback_reset(app, state, &id, "账号认证续期失败", &error);
            }
        }
    }
}

/// 每次到期只执行一轮，按已保存的下次刷新时间调度。
pub(crate) fn start_usage_scheduler(app: tauri::AppHandle) {
    thread::spawn(move || {
        {
            let state = app.state::<AppState>();
            sync_codex_version(&*state);
            backfill_account_metadata(&app, &state);
        }

        let mut next_usage_request_at = Utc::now();
        let mut next_access_check_at = Utc::now();

        loop {
            let now = Utc::now();
            if now >= next_access_check_at {
                refresh_due_access_tokens(&app, &app.state::<AppState>());
                next_access_check_at =
                    Utc::now() + chrono::Duration::seconds(ACCESS_TOKEN_CHECK_INTERVAL_SECONDS);
            }

            let now = Utc::now();
            if now >= next_usage_request_at {
                if let Ok(store) = get_accounts(app.state::<AppState>()) {
                    let state = app.state::<AppState>();
                    let refreshing = state
                        .refreshing
                        .lock()
                        .map(|ids| ids.clone())
                        .unwrap_or_default();
                    let target = store.accounts.iter()
                        .filter_map(|account| {
                            let due_at = account
                                .next_refresh_at
                                .as_deref()
                                .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
                                .map(|time| time.with_timezone(&Utc))
                                .unwrap_or(DateTime::<Utc>::MIN_UTC);
                            (account.can_refresh_usage
                                && !refreshing.contains(&account.id)
                                && due_at <= now)
                                .then_some((due_at, account))
                        })
                        .min_by_key(|(due_at, _)| *due_at)
                        .map(|(_, account)| account);

                    if let Some(account) = target {
                        let should_refresh = match defer_usage_during_quiet_hours(&app, &state, Utc::now()) {
                            Ok(deferred) => !deferred,
                            Err(error) => {
                                save_fallback_reset(&app, &state, &account.id, "免打扰设置处理失败", &error);
                                false
                            }
                        };
                        if should_refresh {
                            // 两个入口都负责保存下次时间并通知异常，调度器不重复发送或补查。
                            if account.auto_activate_window {
                                let _ = tauri::async_runtime::block_on(send_test_message(
                                    app.clone(),
                                    app.state::<AppState>(),
                                    account.id.clone(),
                                    None,
                                ));
                            } else {
                                let _ = tauri::async_runtime::block_on(refresh_account_usage(
                                    app.clone(),
                                    app.state::<AppState>(),
                                    account.id.clone(),
                                ));
                            }
                            next_usage_request_at = Utc::now()
                                + chrono::Duration::seconds(USAGE_REFRESH_BATCH_SLEEP_SECONDS);
                        }
                    }
                }
            }

            thread::sleep(Duration::from_secs(USAGE_CHECK_INTERVAL_SECONDS));
        }
    });
}
