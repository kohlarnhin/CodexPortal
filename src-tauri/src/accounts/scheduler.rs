use crate::accounts::{ensure_account_enabled, read_accounts};
use crate::accounts::messages::activate_due_account;
use crate::accounts::quiet_hours::defer_usage_during_quiet_hours;
use crate::accounts::usage::{
    begin_account_refresh, effective_next_refresh_at, persist_rotated_access_token,
    report_account_request_error, schedule_account_usage_retry,
};
use crate::auth::{exchange_rt_for_at, extract_personal_access_token, resolve_token_metadata};
use crate::codex::version::sync_codex_version;
use crate::state::AppState;
use chrono::{DateTime, Utc};
use rusqlite::params;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;

const RETRY_DELAY: Duration = Duration::from_secs(60);
const ACCESS_TOKEN_CHECK_INTERVAL: Duration = Duration::from_secs(300);

struct MaintenanceJob {
    running: bool,
    next_attempt: Option<Instant>,
    finished: bool,
}

impl MaintenanceJob {
    const fn new() -> Self {
        Self { running: false, next_attempt: None, finished: false }
    }
}

static ACTIVATION_JOB: Mutex<MaintenanceJob> = Mutex::new(MaintenanceJob::new());
static CREDENTIAL_JOB: Mutex<MaintenanceJob> = Mutex::new(MaintenanceJob::new());
static METADATA_JOB: Mutex<MaintenanceJob> = Mutex::new(MaintenanceJob::new());

struct MaintenanceRun {
    job: &'static Mutex<MaintenanceJob>,
    delay: Option<Duration>,
    finished: bool,
}

impl MaintenanceRun {
    fn begin(job: &'static Mutex<MaintenanceJob>) -> Option<Self> {
        let mut state = job.try_lock().ok()?;
        if state.running || state.finished || state.next_attempt.is_some_and(|at| at > Instant::now()) {
            return None;
        }
        state.running = true;
        Some(Self { job, delay: Some(RETRY_DELAY), finished: false })
    }
}

impl Drop for MaintenanceRun {
    fn drop(&mut self) {
        let mut state = self.job.lock().unwrap_or_else(|error| error.into_inner());
        state.next_attempt = self.delay.map(|delay| Instant::now() + delay);
        state.finished = self.finished;
        state.running = false;
    }
}

/// 版本探测只启动一次；不与额度激活或凭证维护互相等待。
pub(crate) fn start_bootstrap(app: tauri::AppHandle) {
    tauri::async_runtime::spawn_blocking(move || sync_codex_version(&app.state::<AppState>()));
}

/// 只有公共巡检调用本入口；所有数据库/网络工作都在有界的独立任务中执行。
pub(crate) fn dispatch(app: &tauri::AppHandle) {
    if let Some(run) = MaintenanceRun::begin(&ACTIVATION_JOB) {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let mut run = run;
            match activate_next_due_account(&app) {
                Ok(false) => run.delay = None,
                // 自动请求结束后至少间隔一分钟；失败同样由下一次到期巡检重试。
                Ok(true) | Err(_) => run.delay = Some(RETRY_DELAY),
            }
        });
    }
    if let Some(run) = MaintenanceRun::begin(&CREDENTIAL_JOB) {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let mut run = run;
            if let Ok(false) = refresh_due_access_tokens(&app, &app.state::<AppState>()) {
                run.delay = Some(ACCESS_TOKEN_CHECK_INTERVAL);
            }
        });
    }
    if let Some(run) = MaintenanceRun::begin(&METADATA_JOB) {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let mut run = run;
            if let Ok(false) = backfill_account_metadata(&app, &app.state::<AppState>()) {
                run.finished = true;
            }
        });
    }
}

fn activate_next_due_account(app: &tauri::AppHandle) -> Result<bool, String> {
    let state = app.state::<AppState>();
    let store = {
        let db = state.db.lock().map_err(|error| error.to_string())?;
        read_accounts(&db)?
    };
    let refreshing = state.refreshing.lock().map_err(|error| error.to_string())?.clone();
    let now = Utc::now();
    let target = store.accounts.iter().filter_map(|account| {
        let due_at = effective_next_refresh_at(account.usage.as_ref(), account.next_refresh_at.as_deref())
            .unwrap_or(DateTime::<Utc>::MIN_UTC);
        (account.enabled && account.can_refresh_usage && !refreshing.contains(&account.id) && due_at <= now)
            .then_some((due_at, account))
    }).min_by_key(|(due_at, _)| *due_at).map(|(_, account)| account);
    let Some(account) = target else { return Ok(false) };
    match defer_usage_during_quiet_hours(app, &state, now) {
        Ok(true) => return Ok(false),
        Ok(false) => {}
        Err(error) => {
            schedule_account_usage_retry(app, &state, &account.id, "免打扰设置处理失败", &error);
            return Err(error);
        }
    }
    tauri::async_runtime::block_on(activate_due_account(app, &state, &account.id))
}

/// 启动回填只处理缺失元数据的 PAT；失败/暂被占用的账号一分钟后再试。
fn backfill_account_metadata(app: &tauri::AppHandle, state: &AppState) -> Result<bool, String> {
    let targets = {
        let db = state.db.lock().map_err(|error| error.to_string())?;
        let mut stmt = db.prepare(
            "SELECT id, auth_json_content FROM accounts WHERE chatgpt_plan_type IS NULL AND is_disabled = 0",
        ).map_err(|error| error.to_string())?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(|error| error.to_string())?;
        let mut targets = Vec::new();
        for row in rows {
            let (id, content) = row.map_err(|error| error.to_string())?;
            if let Some(token) = extract_personal_access_token(&content) { targets.push((id, token)); }
        }
        targets
    };
    let mut retry = false;
    for (id, token) in targets {
        let Ok(_guard) = begin_account_refresh(state, &id, None) else { retry = true; continue };
        {
            let db = state.db.lock().map_err(|error| error.to_string())?;
            if ensure_account_enabled(&db, &id).is_err() { continue; }
        }
        match resolve_token_metadata(&token) {
            Ok(meta) => {
                let db = state.db.lock().map_err(|error| error.to_string())?;
                db.execute(
                    "UPDATE accounts SET chatgpt_plan_type = ?1, chatgpt_account_id = ?2, chatgpt_account_is_fedramp = ?3 WHERE id = ?4",
                    params![meta.chatgpt_plan_type, meta.chatgpt_account_id, meta.chatgpt_account_is_fedramp as i32, id],
                ).map_err(|error| error.to_string())?;
            }
            Err(error) => {
                retry = true;
                report_account_request_error(app, state, &id, "账号信息获取失败", &error);
            }
        }
    }
    Ok(retry)
}

/// 凭证任务自己的重试不改写窗口计划，避免认证故障反复推迟已到期激活。
fn refresh_due_access_tokens(app: &tauri::AppHandle, state: &AppState) -> Result<bool, String> {
    let targets = {
        let db = state.db.lock().map_err(|error| error.to_string())?;
        let cutoff = (Utc::now() + chrono::Duration::minutes(5)).to_rfc3339();
        let mut stmt = db.prepare(
            "SELECT id, refresh_token FROM accounts WHERE is_disabled = 0 AND refresh_token IS NOT NULL AND at_expires_at IS NOT NULL AND at_expires_at <= ?1",
        ).map_err(|error| error.to_string())?;
        let rows = stmt.query_map(params![cutoff], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?
    };
    let mut retry = false;
    for (id, rt) in targets {
        let Ok(_guard) = begin_account_refresh(state, &id, None) else { retry = true; continue };
        let still_current = {
            let db = state.db.lock().map_err(|error| error.to_string())?;
            db.query_row(
                "SELECT refresh_token = ?1 FROM accounts WHERE id = ?2 AND is_disabled = 0",
                params![rt, id], |row| row.get::<_, bool>(0),
            ).unwrap_or(false)
        };
        if !still_current { continue; }
        let result = exchange_rt_for_at(&rt).and_then(|info| {
            let db = state.db.lock().map_err(|error| error.to_string())?;
            persist_rotated_access_token(&db, &id, &rt, &info, true)
        });
        if let Err(error) = result {
            retry = true;
            report_account_request_error(app, state, &id, "账号认证续期失败", &error);
        }
    }
    Ok(retry)
}
