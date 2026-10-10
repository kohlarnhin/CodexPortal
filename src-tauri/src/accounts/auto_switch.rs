use super::usage::{
    begin_account_refresh, fetch_and_persist_account_usage, AccountUsage, AccountUsageWindow,
};
use super::{read_accounts, switch_active_account_locked, Account, ACCOUNT_SWITCH_LOCK};
use crate::codex::events::account_epoch_is_current;
use crate::logging;
use crate::state::AppState;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

const SOURCE: &str = "account-auto-switch";
const ENABLED_KEY: &str = "account_auto_switch_enabled";
const RETRY_INTERVAL: Duration = Duration::from_secs(60);

#[derive(Clone, PartialEq, Eq)]
pub(super) struct SwitchRequest {
    account_id: String,
    epoch: u64,
    settings_generation: u64,
}

struct LiveQuota {
    request: SwitchRequest,
    usage: AccountUsage,
}

struct Attempt {
    request: SwitchRequest,
    threshold: f64,
    started_at: Instant,
}

#[derive(Default)]
struct Runtime {
    live: Option<LiveQuota>,
    pending: Option<SwitchRequest>,
    running: bool,
    last_attempt: Option<Attempt>,
    settings_generation: u64,
}

impl Runtime {
    fn queue(&mut self, request: SwitchRequest) -> bool {
        // 推送只保留最新任务；查询候选和重启期间不创建并行切换任务。
        self.pending = Some(request);
        if self.running {
            return false;
        }
        self.running = true;
        true
    }
}

#[derive(Default)]
pub(crate) struct AutoSwitchState {
    runtime: Mutex<Runtime>,
}

fn read_enabled(db: &Connection) -> Result<bool, String> {
    let content: Option<String> = db.query_row(
        "SELECT content FROM configs WHERE key = ?1",
        params![ENABLED_KEY],
        |row| row.get(0),
    ).optional().map_err(|error| error.to_string())?;
    match content {
        Some(content) => serde_json::from_str(&content).map_err(|error| error.to_string()),
        None => Ok(true),
    }
}

#[tauri::command]
pub(crate) async fn get_auto_switch_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    crate::db::with_db(app, read_enabled).await
}

#[tauri::command]
pub(crate) async fn set_auto_switch_enabled(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<(), String> {
    let settings_app = app.clone();
    let start = crate::db::with_db(app.clone(), move |db| {
        db.execute(
            "INSERT INTO configs (key, content) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET content = ?2",
            params![ENABLED_KEY, enabled.to_string()],
        ).map_err(|error| error.to_string())?;
        let state = settings_app.state::<AutoSwitchState>();
        let mut runtime = state.runtime.lock().map_err(|_| "自动切换状态不可用")?;
        runtime.settings_generation += 1;
        runtime.pending = None;
        runtime.last_attempt = None;
        let generation = runtime.settings_generation;
        if let Some(live) = runtime.live.as_mut() {
            live.request.settings_generation = generation;
        }
        let request = enabled.then(|| runtime.live.as_ref().map(|live| live.request.clone())).flatten();
        Ok(request.is_some_and(|request| runtime.queue(request)))
    }).await?;
    if start {
        tauri::async_runtime::spawn(run_pending(app.clone()));
    }
    let _ = app.emit("auto-switch-settings-updated", enabled);
    logging::info(SOURCE, if enabled { "自动切换已开启。" } else { "自动切换已关闭。" });
    Ok(())
}

fn remaining(window: &AccountUsageWindow) -> Option<f64> {
    window.used_percent
        .filter(|used| used.is_finite() && *used >= 0.0)
        .map(|used| (100.0 - used).clamp(0.0, 100.0))
}

fn expired(window: &AccountUsageWindow, now: i64) -> bool {
    window.resets_at.is_some_and(|reset| reset > 0 && reset <= now)
}

fn reached_threshold(usage: &AccountUsage, threshold: f64, now: i64) -> Option<(&'static str, f64)> {
    [("短周期", usage.primary.as_ref()), ("长周期", usage.secondary.as_ref())]
        .into_iter()
        .find_map(|(label, window)| {
            let window = window?;
            if expired(window, now) {
                return None;
            }
            let percent = remaining(window)?;
            (percent <= threshold).then_some((label, percent))
        })
}

fn candidate_reset(account: &Account, now: i64) -> Option<i64> {
    if account.is_active || !account.can_activate {
        return None;
    }
    let usage = account.usage.as_ref()?;
    let primary = usage.primary.as_ref()?;
    let reset = primary.resets_at.filter(|reset| {
        *reset > now && chrono::DateTime::from_timestamp(*reset, 0).is_some()
    })?;
    if remaining(primary)? <= account.auto_switch_threshold {
        return None;
    }
    // 没有长周期限制的账号可用；有该窗口时必须确认它仍有可用额度。
    if let Some(secondary) = usage.secondary.as_ref() {
        if expired(secondary, now) || remaining(secondary)? <= account.auto_switch_threshold {
            return None;
        }
    }
    Some(reset)
}

fn live_usage(app: &tauri::AppHandle, request: &SwitchRequest) -> Option<AccountUsage> {
    let state = app.state::<AutoSwitchState>();
    let runtime = state.runtime.lock().ok()?;
    runtime.live.as_ref()
        .filter(|live| live.request == *request)
        .map(|live| live.usage.clone())
}

fn current_trigger(
    app: &tauri::AppHandle,
    db: &Connection,
    request: &SwitchRequest,
) -> Result<Option<(f64, &'static str, f64)>, String> {
    if !account_epoch_is_current(app, request.epoch) || !read_enabled(db)? {
        return Ok(None);
    }
    let Some(usage) = live_usage(app, request) else {
        return Ok(None);
    };
    let threshold: Option<f64> = db.query_row(
        "SELECT auto_switch_threshold FROM accounts WHERE id = ?1 AND is_active = 1",
        params![request.account_id],
        |row| row.get(0),
    ).optional().map_err(|error| error.to_string())?;
    let Some(threshold) = threshold else {
        return Ok(None);
    };
    Ok(reached_threshold(&usage, threshold, Utc::now().timestamp())
        .map(|(window, percent)| (threshold, window, percent)))
}

pub(super) fn selection_is_current(
    app: &tauri::AppHandle,
    db: &Connection,
    request: &SwitchRequest,
    target_id: &str,
) -> Result<bool, String> {
    if current_trigger(app, db, request)?.is_none() {
        return Ok(false);
    }
    let store = read_accounts(db)?;
    Ok(store.accounts.iter().find(|account| account.id == target_id)
        .and_then(|account| candidate_reset(account, Utc::now().timestamp())).is_some())
}

/// 只由当前连接的官方额度快照驱动，不从历史会话或后台账号缓存触发切换。
pub(crate) fn schedule(
    app: tauri::AppHandle,
    account_id: String,
    epoch: u64,
    usage: AccountUsage,
) {
    if !account_epoch_is_current(&app, epoch) {
        return;
    }
    let start = {
        let state = app.state::<AutoSwitchState>();
        let Ok(mut runtime) = state.runtime.lock() else { return };
        if runtime.live.as_ref().is_some_and(|live| live.request.epoch > epoch) {
            return;
        }
        let request = SwitchRequest { account_id, epoch, settings_generation: runtime.settings_generation };
        runtime.live = Some(LiveQuota { request: request.clone(), usage });
        runtime.queue(request)
    };
    if start {
        tauri::async_runtime::spawn(run_pending(app));
    }
}

#[tauri::command]
pub(crate) async fn set_auto_switch_threshold(
    app: tauri::AppHandle,
    id: String,
    threshold: f64,
) -> Result<(), String> {
    if !threshold.is_finite() || !(0.0..=100.0).contains(&threshold) {
        return Err("自动切换阈值必须在 0% 到 100% 之间。".to_string());
    }
    let account_id = id.clone();
    crate::db::with_db(app.clone(), move |db| {
        let changed = db.execute(
            "UPDATE accounts SET auto_switch_threshold = ?1 WHERE id = ?2",
            params![threshold, account_id],
        ).map_err(|error| error.to_string())?;
        if changed == 0 {
            return Err("账号不存在".to_string());
        }
        Ok(())
    }).await?;
    let _ = app.emit("accounts-updated", ());
    let start = {
        let state = app.state::<AutoSwitchState>();
        let mut runtime = state.runtime.lock().map_err(|_| "自动切换状态不可用")?;
        let request = runtime.live.as_ref()
            .filter(|live| live.request.account_id == id)
            .map(|live| live.request.clone());
        if let Some(request) = request {
            runtime.last_attempt = None;
            runtime.queue(request)
        } else {
            false
        }
    };
    if start {
        tauri::async_runtime::spawn(run_pending(app));
    }
    logging::info(SOURCE, format!("账号自动切换阈值已保存为 {threshold}%。"));
    Ok(())
}

async fn run_pending(app: tauri::AppHandle) {
    loop {
        let request = {
            let state = app.state::<AutoSwitchState>();
            let Ok(mut runtime) = state.runtime.lock() else { return };
            match runtime.pending.take() {
                Some(request) => request,
                None => {
                    runtime.running = false;
                    return;
                }
            }
        };
        if try_switch(&app, &request).await.is_err() {
            logging::error(SOURCE, "自动切换未完成；请检查账号认证或网络，后续额度更新时将重试。");
        }
    }
}

async fn try_switch(app: &tauri::AppHandle, request: &SwitchRequest) -> Result<(), String> {
    let state = app.state::<AppState>();
    let (threshold, window, percent, candidate_ids) = {
        let db = state.db.lock().map_err(|error| error.to_string())?;
        let Some((threshold, window, percent)) = current_trigger(app, &db, request)? else {
            return Ok(());
        };
        let store = read_accounts(&db)?;
        let ids: Vec<String> = store.accounts.into_iter()
            .filter(|account| !account.is_active && account.can_activate && account.can_refresh_usage)
            .map(|account| account.id)
            .collect();
        (threshold, window, percent, ids)
    };
    {
        let auto = app.state::<AutoSwitchState>();
        let mut runtime = auto.runtime.lock().map_err(|_| "自动切换状态不可用")?;
        if runtime.last_attempt.as_ref().is_some_and(|attempt| {
            attempt.request == *request && attempt.threshold == threshold
                && attempt.started_at.elapsed() < RETRY_INTERVAL
        }) {
            return Ok(());
        }
        runtime.last_attempt = Some(Attempt {
            request: request.clone(), threshold, started_at: Instant::now(),
        });
    }
    logging::info(SOURCE, format!(
        "{window}剩余 {percent:.1}%，达到自动切换阈值 {threshold}%，正在选择可用账号。"
    ));

    let mut verified = Vec::new();
    for id in candidate_ids {
        {
            let db = state.db.lock().map_err(|error| error.to_string())?;
            if current_trigger(app, &db, request)?.is_none() {
                return Ok(());
            }
        }
        // 失败不写入虚构的重置时间；只有查询成功的账号参与本次排序。
        let Ok(_guard) = begin_account_refresh(&state, &id, Some(app.clone())) else { continue };
        if fetch_and_persist_account_usage(app, &state, &id).await.is_ok() {
            verified.push(id);
        } else {
            logging::warn(SOURCE, "候选账号额度查询失败，已跳过该账号。");
        }
    }

    // 候选查询不阻塞手动切换；提交时与手动入口、托盘共用同一把锁。
    let Ok(_switch_guard) = ACCOUNT_SWITCH_LOCK.try_lock() else { return Ok(()) };
    let candidates = {
        let db = state.db.lock().map_err(|error| error.to_string())?;
        if current_trigger(app, &db, request)?.is_none() {
            return Ok(());
        }
        let now = Utc::now().timestamp();
        let store = read_accounts(&db)?;
        let mut candidates: Vec<_> = store.accounts.iter()
            .filter(|account| verified.contains(&account.id))
            .filter_map(|account| candidate_reset(account, now).map(|reset| (reset, account.id.clone())))
            .collect();
        // 所有重置时间均在未来，因此时间越小，距离下一次短周期重置越近。
        candidates.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
        candidates
    };
    for (reset, id) in candidates {
        match switch_active_account_locked(app, &state, &id, Some(request)).await {
            Ok(true) => {
                let reset_label = chrono::DateTime::from_timestamp(reset, 0)
                    .map(|time| time.with_timezone(&chrono::Local).format("%m-%d %H:%M").to_string())
                    .unwrap_or_else(|| reset.to_string());
                logging::info(SOURCE, format!(
                    "自动切换已完成；所选账号短周期将在 {reset_label} 重置。"
                ));
                return Ok(());
            }
            Ok(false) => {
                let db = state.db.lock().map_err(|error| error.to_string())?;
                if current_trigger(app, &db, request)?.is_none() {
                    return Ok(());
                }
            }
            Err(_) => logging::warn(SOURCE, "候选账号切换失败，正在尝试下一个可用账号。"),
        }
    }
    logging::warn(SOURCE, "没有可切换的账号：需有可用认证、足够的剩余额度和有效的短周期重置时间。保留当前账号，后续额度更新时将重试。");
    Ok(())
}
