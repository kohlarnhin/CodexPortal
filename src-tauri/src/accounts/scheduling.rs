use super::usage::{
    begin_account_refresh, fetch_and_persist_account_usage,
    AccountUsageWindow,
};
use super::{read_accounts, switch_active_account_locked, Account, AccountStore, ACCOUNT_SWITCH_LOCK};
use crate::auth::AccountType;
use crate::logging;
use crate::state::AppState;
use chrono::{Local, Utc};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;

const SOURCE: &str = "smart-schedule";
const FAILURE_COOLDOWN: Duration = Duration::from_secs(60);
const MIN_TARGET_WINDOW_SECONDS: i64 = 300;
const EXPIRY_ADVANTAGE_SECONDS: i64 = 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SwitchReason {
    CurrentUnavailable,
    EarlierExpiry,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Decision {
    Keep,
    Switch { account_id: String, reason: SwitchReason },
    NoUsableAccounts {
        earliest_recovery_at: Option<i64>,
        fallback_account_id: Option<String>,
    },
}

impl Decision {
    pub(super) fn target_id(&self) -> Option<&str> {
        match self {
            Self::Switch { account_id, .. } => Some(account_id),
            Self::NoUsableAccounts { fallback_account_id, .. } => fallback_account_id.as_deref(),
            Self::Keep => None,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScheduleAccount {
    id: String,
    remaining_percent: f64,
    resets_at: Option<i64>,
    usable: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScheduleStatus {
    current: Option<ScheduleAccount>,
    next: Option<ScheduleAccount>,
    all_exhausted: bool,
    earliest_recovery_at: Option<i64>,
}

#[derive(Debug)]
pub(super) struct Schedule {
    pub(super) decision: Decision,
    pub(super) status: ScheduleStatus,
}

pub(super) fn eligible(account: &Account) -> bool {
    account.enabled && account.account_type == AccountType::Chatgpt
        && account.can_activate && account.can_refresh_usage
}

#[derive(Clone, Copy)]
struct Window {
    remaining: f64,
    resets_at: Option<i64>,
}

fn window_state(window: Option<&AccountUsageWindow>, now: i64) -> Window {
    match window.filter(|window| window.resets_at.is_some_and(|reset| reset > now)) {
        Some(window) => Window {
            remaining: (100.0 - window.used_percent.filter(|used| used.is_finite()).unwrap_or(0.0))
                .clamp(0.0, 100.0),
            resets_at: window.resets_at,
        },
        None => Window { remaining: 100.0, resets_at: None },
    }
}

fn windows(account: &Account, now: i64) -> (Window, Window) {
    let usage = account.usage.as_ref();
    (
        window_state(usage.and_then(|usage| usage.primary.as_ref()), now),
        window_state(usage.and_then(|usage| usage.secondary.as_ref()), now),
    )
}

fn usable(account: &Account, now: i64) -> bool {
    let (primary, secondary) = windows(account, now);
    eligible(account) && primary.remaining > 0.0 && secondary.remaining > 0.0
}

fn sort_key(account: &Account, now: i64) -> (i64, i64, &str) {
    let (primary, secondary) = windows(account, now);
    (primary.resets_at.unwrap_or(i64::MAX), secondary.resets_at.unwrap_or(i64::MAX), &account.id)
}

fn recovery_at(account: &Account, now: i64) -> Option<i64> {
    let (primary, secondary) = windows(account, now);
    [primary, secondary].into_iter()
        .filter(|window| window.remaining <= 0.0)
        .filter_map(|window| window.resets_at)
        .max()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentAccount {
    name: String,
    usable: bool,
    short_remaining_percent: u8,
    short_resets_at: Option<String>,
    long_remaining_percent: u8,
    long_resets_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentStatus {
    current: Option<AgentAccount>,
    next: Option<AgentAccount>,
    all_exhausted: bool,
    earliest_recovery_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct SwitchResult {
    switched: bool,
    #[serde(flatten)]
    status: AgentStatus,
}

fn local_timestamp(timestamp: Option<i64>) -> Option<String> {
    timestamp.and_then(|timestamp| chrono::DateTime::from_timestamp(timestamp, 0))
        .map(|time| time.with_timezone(&Local).to_rfc3339_opts(chrono::SecondsFormat::Secs, false))
}

fn agent_account(account: &Account, now: i64) -> AgentAccount {
    let (short, long) = windows(account, now);
    AgentAccount {
        name: crate::tray::display_name(&account.name, true),
        usable: usable(account, now),
        short_remaining_percent: short.remaining.round() as u8,
        short_resets_at: local_timestamp(short.resets_at),
        long_remaining_percent: long.remaining.round() as u8,
        long_resets_at: local_timestamp(long.resets_at),
    }
}

pub(crate) fn agent_status(store: &AccountStore, now: i64) -> AgentStatus {
    let status = evaluate_schedule(&store.accounts, store.active_account_id.as_deref(), now).status;
    AgentStatus {
        current: store.accounts.iter().find(|account| Some(&account.id) == store.active_account_id.as_ref())
            .map(|account| agent_account(account, now)),
        next: status.next.and_then(|next| store.accounts.iter().find(|account| account.id == next.id))
            .map(|account| agent_account(account, now)),
        all_exhausted: status.all_exhausted,
        earliest_recovery_at: local_timestamp(status.earliest_recovery_at),
    }
}

fn schedule_account(account: &Account, now: i64) -> ScheduleAccount {
    let (primary, _) = windows(account, now);
    ScheduleAccount {
        id: account.id.clone(), remaining_percent: primary.remaining,
        resets_at: primary.resets_at, usable: usable(account, now),
    }
}

/// 只依赖账号快照和秒级时间；执行、删除接替和预览共用这一套决策。
pub(super) fn evaluate_schedule(accounts: &[Account], current_id: Option<&str>, now: i64) -> Schedule {
    let current = accounts.iter().find(|account| Some(account.id.as_str()) == current_id);
    let current_usable = current.is_some_and(|account| usable(account, now));
    let mut available: Vec<_> = accounts.iter().filter(|account| usable(account, now)).collect();
    available.sort_by_key(|account| sort_key(account, now));
    let mut recovering: Vec<_> = accounts.iter().filter(|account| eligible(account))
        .filter_map(|account| recovery_at(account, now).map(|reset| (reset, account)))
        .collect();
    recovering.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| sort_key(a.1, now).cmp(&sort_key(b.1, now))));
    let earliest_recovery_at = recovering.first().map(|(reset, _)| *reset);
    let status = ScheduleStatus {
        current: current.map(|account| schedule_account(account, now)),
        // 预览表示当前账号用完/到期后的接替者，不应用主动抢占的五分钟过滤。
        next: available.iter().find(|account| Some(account.id.as_str()) != current_id)
            .map(|account| schedule_account(account, now)),
        all_exhausted: available.is_empty() && !recovering.is_empty(),
        earliest_recovery_at,
    };
    let decision = if current_usable {
        let current_reset = windows(current.unwrap(), now).0.resets_at;
        let target = available.iter()
            .filter(|account| Some(account.id.as_str()) != current_id)
            .find(|account| windows(account, now).0.resets_at
                .is_none_or(|reset| reset.saturating_sub(now) >= MIN_TARGET_WINDOW_SECONDS));
        match target {
            Some(target) if windows(target, now).0.resets_at.is_some_and(|reset| {
                current_reset.is_none_or(|current| current.saturating_sub(reset) > EXPIRY_ADVANTAGE_SECONDS)
            }) => Decision::Switch { account_id: target.id.clone(), reason: SwitchReason::EarlierExpiry },
            _ => Decision::Keep,
        }
    } else if let Some(target) = available.first() {
        Decision::Switch { account_id: target.id.clone(), reason: SwitchReason::CurrentUnavailable }
    } else {
        Decision::NoUsableAccounts {
            earliest_recovery_at,
            fallback_account_id: if current.is_some_and(eligible) { None }
                else { recovering.first().map(|(_, account)| account.id.clone()) },
        }
    };
    Schedule { decision, status }
}

#[tauri::command]
pub(crate) async fn get_schedule_status(app: tauri::AppHandle) -> Result<ScheduleStatus, String> {
    crate::db::with_db(app, |db| {
        let store = read_accounts(db)?;
        Ok(evaluate_schedule(&store.accounts, store.active_account_id.as_deref(), Utc::now().timestamp()).status)
    }).await
}

#[derive(Default)]
struct EvaluationState {
    running: bool,
    next_attempt: Option<Instant>,
    failures: HashMap<String, Instant>,
    exhausted_until: Option<i64>,
    lifecycle_requested: bool,
}

impl EvaluationState {
    fn request(&mut self) -> bool {
        if self.running || self.next_attempt.is_some_and(|at| at > Instant::now()) { return false; }
        self.running = true;
        true
    }

    fn finish(&mut self, failed: bool) {
        if failed { self.next_attempt = Some(Instant::now() + FAILURE_COOLDOWN); }
        self.running = false;
    }
}

pub(crate) struct ScheduleState {
    evaluation: Mutex<EvaluationState>,
}

impl Default for ScheduleState {
    fn default() -> Self {
        Self { evaluation: Mutex::new(EvaluationState { lifecycle_requested: true, ..Default::default() }) }
    }
}

#[derive(Clone)]
pub(super) enum SwitchTrigger {
    OnDemand,
    Exhausted(String),
    Lifecycle,
}

fn current_exhausted(store: &AccountStore, now: i64) -> Option<&Account> {
    store.accounts.iter().find(|account| Some(&account.id) == store.active_account_id.as_ref())
        .filter(|account| eligible(account) && !usable(account, now))
}

impl SwitchTrigger {
    fn allows(&self, store: &AccountStore, now: i64) -> bool {
        match self {
            Self::OnDemand => true,
            Self::Exhausted(id) => current_exhausted(store, now).is_some_and(|account| account.id == *id),
            Self::Lifecycle => store.accounts.iter()
                .find(|account| Some(&account.id) == store.active_account_id.as_ref())
                .is_none_or(|account| !account.enabled),
        }
    }
}

struct SwitchRun {
    app: tauri::AppHandle,
    failed: bool,
    retry_lifecycle: bool,
}

impl SwitchRun {
    fn begin(app: &tauri::AppHandle) -> Option<Self> {
        let state = app.state::<ScheduleState>();
        let mut evaluation = state.evaluation.try_lock().ok()?;
        if !evaluation.request() { return None; }
        Some(Self { app: app.clone(), failed: true, retry_lifecycle: false })
    }
}

impl Drop for SwitchRun {
    fn drop(&mut self) {
        let state = self.app.state::<ScheduleState>();
        let mut evaluation = state.evaluation.lock().unwrap_or_else(|error| error.into_inner());
        if self.retry_lifecycle { evaluation.lifecycle_requested = true; }
        evaluation.finish(self.failed);
    }
}

/// 账号生命周期操作只标记下一次公共巡检，不能触发健康账号之间的抢占。
pub(crate) fn request_lifecycle_evaluation(app: tauri::AppHandle) {
    let state = app.state::<ScheduleState>();
    if let Ok(mut evaluation) = state.evaluation.lock() { evaluation.lifecycle_requested = true; };
}

/// 巡检先查本地缓存；健康账号不会触发候选 HTTP 查询或按到期时间抢占。
pub(crate) fn dispatch_patrol(app: &tauri::AppHandle) {
    let Some(run) = SwitchRun::begin(app) else { return };
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut run = run;
        let result = tauri::async_runtime::block_on(async {
            let store = read_store(&app.state::<AppState>())?;
            let lifecycle = {
                let state = app.state::<ScheduleState>();
                let mut evaluation = state.evaluation.lock().map_err(|error| error.to_string())?;
                std::mem::take(&mut evaluation.lifecycle_requested)
            };
            run.retry_lifecycle = lifecycle;
            let trigger = if let Some(current) = current_exhausted(&store, Utc::now().timestamp()) {
                Some(SwitchTrigger::Exhausted(current.id.clone()))
            } else if lifecycle && SwitchTrigger::Lifecycle.allows(&store, Utc::now().timestamp()) {
                Some(SwitchTrigger::Lifecycle)
            } else {
                None
            };
            let Some(trigger) = trigger else { return Ok::<(), String>(()) };
            let plan = evaluate_candidates_for_trigger(&store, &HashSet::new(), Utc::now().timestamp(), &trigger);
            log_exhaustion(&app, &plan.status);
            // 没有候选时只检查缓存，不每三十秒反复请求当前账号。
            if plan.decision.target_id().is_none() { return Ok(()); }
            execute_switch(&app, &trigger).await.map(|_| ())
        });
        let result = result.and_then(|()| {
            if run.retry_lifecycle {
                // 正常返回也可能是候选全部失败；在持有评估锁之前确认生命周期已恢复。
                let store = read_store(&app.state::<AppState>())?;
                run.retry_lifecycle = SwitchTrigger::Lifecycle.allows(&store, Utc::now().timestamp());
            }
            Ok(())
        });
        run.failed = result.is_err();
        if run.failed { logging::warn(SOURCE, "智能调度未完成，一分钟后由巡检重试。"); }
    });
}

fn read_store(state: &AppState) -> Result<AccountStore, String> {
    let db = state.db.lock().map_err(|error| error.to_string())?;
    read_accounts(&db)
}

/// 失败冷却只排除候选，保留当前账号的缓存，避免把查询失败误判为额度耗尽。
pub(super) fn evaluate_candidates(store: &AccountStore, excluded: &HashSet<String>, now: i64) -> Schedule {
    let accounts: Vec<_> = store.accounts.iter()
        .filter(|account| store.active_account_id.as_ref() == Some(&account.id) || !excluded.contains(&account.id))
        .cloned().collect();
    evaluate_schedule(&accounts, store.active_account_id.as_deref(), now)
}

/// 从初次筛选到最终数据库提交，始终带上原始业务触发约束。
pub(super) fn evaluate_candidates_for_trigger(
    store: &AccountStore, excluded: &HashSet<String>, now: i64, trigger: &SwitchTrigger,
) -> Schedule {
    let mut plan = evaluate_candidates(store, excluded, now);
    if !trigger.allows(store, now) { plan.decision = Decision::Keep; }
    plan
}

fn mark_failure(app: &tauri::AppHandle, id: &str) {
    let state = app.state::<ScheduleState>();
    if let Ok(mut evaluation) = state.evaluation.lock() {
        let now = Instant::now();
        evaluation.failures.insert(id.to_string(), now);
        evaluation.next_attempt = Some(now + FAILURE_COOLDOWN);
    };
}

fn time_label(timestamp: i64) -> String {
    chrono::DateTime::from_timestamp(timestamp, 0)
        .map(|time| time.with_timezone(&Local).format("%H:%M").to_string())
        .unwrap_or_else(|| timestamp.to_string())
}

fn log_exhaustion(app: &tauri::AppHandle, status: &ScheduleStatus) {
    let next = status.all_exhausted.then_some(status.earliest_recovery_at).flatten();
    let state = app.state::<ScheduleState>();
    if let Ok(mut evaluation) = state.evaluation.lock() {
        if evaluation.exhausted_until != next {
            evaluation.exhausted_until = next;
            if let Some(reset) = next {
                logging::info(SOURCE, format!("所有账号额度已用完，最早 {} 恢复。", time_label(reset)));
            }
        }
    };
}

async fn refresh_for_evaluation(app: &tauri::AppHandle, state: &AppState, id: &str) -> Result<bool, String> {
    let _guard = begin_account_refresh(state, id, Some(app.clone()))?;
    if fetch_and_persist_account_usage(app, state, id).await.is_err() {
        mark_failure(app, id);
        logging::warn(SOURCE, "账号额度查询失败，一分钟内不再选择该候选账号。");
        return Ok(false);
    }
    Ok(true)
}

pub(crate) async fn switch_on_demand(app: &tauri::AppHandle) -> Result<SwitchResult, String> {
    let Some(run) = SwitchRun::begin(app) else {
        return Err("智能切换正在执行或等待重试，请稍候。".into());
    };
    logging::info("mcp", "收到 MCP 切换请求，正在核对当前账号额度。");
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut run = run;
        let result = tauri::async_runtime::block_on(execute_switch(&app, &SwitchTrigger::OnDemand));
        run.failed = result.is_err();
        result
    }).await.map_err(|_| "智能切换任务失败，一分钟后可重试。".to_string())?
}

/// MCP 和巡检共用唯一执行流程；自动触发在当前账号恢复后立即终止。
async fn execute_switch(app: &tauri::AppHandle, trigger: &SwitchTrigger) -> Result<SwitchResult, String> {
    let state = app.state::<AppState>();
    let store = read_store(&state)?;
    let before = store.active_account_id.clone();
    let mut verified = HashSet::new();
    if trigger.allows(&store, Utc::now().timestamp()) {
        if let Some(current) = store.accounts.iter()
            .find(|account| Some(&account.id) == before.as_ref()).filter(|account| eligible(account)) {
            if !refresh_for_evaluation(app, &state, &current.id).await? {
                return Err("当前账号额度查询失败，未执行切换。".into());
            }
            verified.insert(current.id.clone());
        }
        evaluate_accounts(app, verified, trigger).await?;
    }
    let store = read_store(&state)?;
    Ok(SwitchResult {
        switched: before != store.active_account_id,
        status: agent_status(&store, Utc::now().timestamp()),
    })
}

async fn evaluate_accounts(
    app: &tauri::AppHandle, mut verified: HashSet<String>, trigger: &SwitchTrigger,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut excluded: HashSet<String> = {
        let schedule = app.state::<ScheduleState>();
        let mut evaluation = schedule.evaluation.lock().map_err(|error| error.to_string())?;
        evaluation.failures.retain(|_, failed| failed.elapsed() < FAILURE_COOLDOWN);
        evaluation.failures.keys().cloned().collect()
    };
    let store = read_store(&state)?;
    let now = Utc::now().timestamp();
    log_exhaustion(app, &evaluate_schedule(&store.accounts, store.active_account_id.as_deref(), now).status);
    if evaluate_candidates_for_trigger(&store, &excluded, now, trigger).decision.target_id().is_none() { return Ok(()); }

    let current = store.accounts.iter().find(|account| Some(&account.id) == store.active_account_id.as_ref());
    let mut to_refresh: Vec<_> = store.accounts.iter().filter(|account| eligible(account))
        .filter(|account| !verified.contains(&account.id))
        .filter(|account| !excluded.contains(&account.id))
        .filter(|account| current.is_none_or(|current| !usable(current, now)
            || sort_key(account, now) <= sort_key(current, now)))
        .collect();
    to_refresh.sort_by(|a, b| sort_key(a, now).cmp(&sort_key(b, now)));
    for account in to_refresh {
        if !trigger.allows(&read_store(&state)?, Utc::now().timestamp()) { return Ok(()); }
        if refresh_for_evaluation(app, &state, &account.id).await? {
            verified.insert(account.id.clone());
        } else {
            excluded.insert(account.id.clone());
        }
    }

    loop {
        let store = read_store(&state)?;
        let now = Utc::now().timestamp();
        log_exhaustion(app, &evaluate_schedule(&store.accounts, store.active_account_id.as_deref(), now).status);
        let plan = evaluate_candidates_for_trigger(&store, &excluded, now, trigger);
        let Some(id) = plan.decision.target_id().map(str::to_string) else { return Ok(()) };
        // 同一轮每个候选最多确认一次；不在任务内等待或重试失败候选。
        if !verified.contains(&id) {
            if refresh_for_evaluation(app, &state, &id).await? {
                verified.insert(id);
            } else {
                excluded.insert(id);
            }
            continue;
        }
        let result = {
            let _switch_guard = ACCOUNT_SWITCH_LOCK.try_lock()
                .map_err(|_| "账号切换被其他操作占用，请稍后重试。".to_string())?;
            let latest = evaluate_candidates_for_trigger(&read_store(&state)?, &excluded, Utc::now().timestamp(), trigger);
            if latest.decision.target_id() != Some(id.as_str()) { return Ok(()); }
            switch_active_account_locked(app, &state, &id, &excluded, trigger).await
        };
        match result {
            Ok(true) => {
                let reset = store.accounts.iter().find(|account| account.id == id)
                    .and_then(|account| windows(account, Utc::now().timestamp()).0.resets_at);
                let expiry = reset.map(|reset| format!("新账号短周期 {} 到期", time_label(reset)))
                    .unwrap_or_else(|| "新账号短周期已重置或尚未开窗".to_string());
                let reason = match plan.decision {
                    Decision::Switch { reason: SwitchReason::EarlierExpiry, .. } => "有更早到期的账号，已切换",
                    _ if current.is_some_and(|account| eligible(account) && !usable(account, now)) =>
                        "当前账号额度已用完，已切换",
                    _ => "当前账号不可用，已切换",
                };
                logging::info(SOURCE, format!("{reason}；{expiry}。"));
                return Ok(());
            }
            Ok(false) => return Ok(()),
            Err(_) => {
                mark_failure(app, &id);
                excluded.insert(id);
                logging::warn(SOURCE, "候选账号切换失败，一分钟内跳过，正在评估下一个账号。");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::accounts::AuthMethod;

    const NOW: i64 = 1_900_000_000;

    fn account(id: &str, used: f64, reset: Option<i64>) -> Account {
        Account {
            id: id.to_string(),
            account_type: AccountType::Chatgpt,
            auth_method: AuthMethod::Pat,
            enabled: true,
            name: "test@example.invalid".to_string(),
            auth_json_content: crate::auth::build_auth_json("test-pat"),
            notes: None,
            created_at: String::new(),
            updated_at: String::new(),
            plan_type: "weekly".to_string(),
            usage: Some(crate::test_support::usage(used, reset)),
            can_refresh_usage: true,
            can_activate: true,
            next_refresh_at: None,
            chatgpt_plan_type: None,
            has_access_token: false,
            reset_credits: None,
            is_active: false,
            access_token: None,
            chatgpt_account_id: None,
            chatgpt_account_is_fedramp: false,
            refresh_token: None,
            at_expires_at: None,
        }
    }

    fn secondary(account: &mut Account, used: f64, reset: i64) {
        account.usage.as_mut().unwrap().secondary = Some(AccountUsageWindow {
            used_percent: Some(used), window_minutes: Some(7 * 24 * 60), resets_at: Some(reset),
        });
    }

    #[test]
    fn chooses_earliest_short_window_even_when_current_has_quota() {
        let accounts = vec![account("current", 10.0, Some(NOW + 3600)),
            account("later", 0.0, Some(NOW + 1800)), account("earliest", 95.0, Some(NOW + 900))];
        let plan = evaluate_schedule(&accounts, Some("current"), NOW);
        assert_eq!(plan.decision, Decision::Switch {
            account_id: "earliest".into(), reason: SwitchReason::EarlierExpiry,
        });
        assert_eq!(plan.status.current.unwrap().remaining_percent, 90.0);
        assert_eq!(plan.status.next.unwrap().id, "earliest");
    }

    #[test]
    fn exhausted_short_or_long_windows_are_not_usable() {
        let mut long_exhausted = account("long", 0.0, Some(NOW + 600));
        secondary(&mut long_exhausted, 100.0, NOW + 10_000);
        let accounts = vec![account("short", 100.0, Some(NOW + 400)), long_exhausted,
            account("usable", 99.9, Some(NOW + 1800))];
        assert_eq!(evaluate_schedule(&accounts, None, NOW).decision.target_id(), Some("usable"));
        for current in ["short", "long"] {
            assert_eq!(evaluate_schedule(&accounts, Some(current), NOW).decision, Decision::Switch {
                account_id: "usable".into(), reason: SwitchReason::CurrentUnavailable,
            });
        }
    }

    #[test]
    fn expired_missing_and_unopened_windows_have_full_quota_and_sort_last() {
        let mut expired = account("expired", 100.0, Some(NOW));
        secondary(&mut expired, 100.0, NOW - 1);
        let mut missing = account("missing", 100.0, Some(NOW - 1));
        missing.usage = None;
        let mut no_primary = account("no-primary", 100.0, Some(NOW + 600));
        no_primary.usage.as_mut().unwrap().primary = None;
        let no_reset = account("no-reset", 100.0, None);
        for reset in [&expired, &missing, &no_primary, &no_reset] {
            assert!(usable(reset, NOW));
            assert_eq!(windows(reset, NOW).0.remaining, 100.0);
            assert_eq!(windows(reset, NOW).0.resets_at, None);
        }
        let accounts = vec![expired, missing, no_primary, no_reset, account("running", 80.0, Some(NOW + 900))];
        assert_eq!(evaluate_schedule(&accounts, None, NOW).decision.target_id(), Some("running"));
        assert_eq!(evaluate_schedule(&accounts, Some("expired"), NOW).decision.target_id(), Some("running"));
    }

    #[test]
    fn missing_usage_percent_means_unused_quota() {
        let mut unknown = account("unknown", 100.0, Some(NOW + 900));
        unknown.usage.as_mut().unwrap().primary.as_mut().unwrap().used_percent = None;
        secondary(&mut unknown, 100.0, NOW + 10_000);
        unknown.usage.as_mut().unwrap().secondary.as_mut().unwrap().used_percent = None;
        assert!(usable(&unknown, NOW));
        assert_eq!(windows(&unknown, NOW).0.remaining, 100.0);
    }

    #[test]
    fn expiry_advantage_must_exceed_sixty_seconds() {
        for difference in [0, 1, 59, 60] {
            let accounts = vec![account("current", 0.0, Some(NOW + 1800)),
                account("target", 0.0, Some(NOW + 1800 - difference))];
            assert_eq!(evaluate_schedule(&accounts, Some("current"), NOW).decision, Decision::Keep);
        }
        let accounts = vec![account("current", 0.0, Some(NOW + 1800)),
            account("target", 0.0, Some(NOW + 1739))];
        assert_eq!(evaluate_schedule(&accounts, Some("current"), NOW).decision.target_id(), Some("target"));
        // 对齐的窗口不能因为 id 或长周期次序不同来回抢占。
        assert_eq!(evaluate_schedule(&accounts, Some("target"), NOW).decision, Decision::Keep);
    }

    #[test]
    fn near_expiry_filter_depends_on_current_availability_and_includes_boundary() {
        for seconds in [1, 299] {
            let mut accounts = vec![account("current", 0.0, Some(NOW + 1800)),
                account("near", 0.0, Some(NOW + seconds)), account("later", 0.0, Some(NOW + 900))];
            assert_eq!(evaluate_schedule(&accounts, Some("current"), NOW).decision.target_id(), Some("later"));
            // 预览仍包含即将到期的接替者。
            assert_eq!(evaluate_schedule(&accounts, Some("current"), NOW).status.next.unwrap().id, "near");
            accounts[0].usage.as_mut().unwrap().primary.as_mut().unwrap().used_percent = Some(100.0);
            assert_eq!(evaluate_schedule(&accounts, Some("current"), NOW).decision.target_id(), Some("near"));
        }
        let accounts = vec![account("current", 0.0, Some(NOW + 1800)),
            account("boundary", 0.0, Some(NOW + 300))];
        assert_eq!(evaluate_schedule(&accounts, Some("current"), NOW).decision.target_id(), Some("boundary"));
        let accounts = vec![account("current", 0.0, Some(NOW + 1800)),
            account("near", 0.0, Some(NOW + 299))];
        assert_eq!(evaluate_schedule(&accounts, Some("current"), NOW).decision, Decision::Keep);
    }

    #[test]
    fn excludes_disabled_api_and_accounts_without_credentials() {
        let mut disabled = account("disabled", 0.0, Some(NOW + 100));
        disabled.enabled = false;
        let mut api = account("api", 0.0, Some(NOW + 100));
        api.account_type = AccountType::OpenaiApiKey;
        let mut no_activation = account("no-activation", 0.0, Some(NOW + 100));
        no_activation.can_activate = false;
        let mut no_usage = account("no-usage", 0.0, Some(NOW + 100));
        no_usage.can_refresh_usage = false;
        let accounts = vec![disabled, api, no_activation, no_usage, account("eligible", 0.0, Some(NOW + 900))];
        for current in [None, Some("disabled"), Some("api"), Some("deleted"), Some("no-activation"), Some("no-usage")] {
            assert_eq!(evaluate_schedule(&accounts, current, NOW).decision.target_id(), Some("eligible"));
        }
    }

    #[test]
    fn secondary_expiry_breaks_primary_ties_then_id_breaks_remaining_ties() {
        let mut a = account("a", 0.0, Some(NOW + 900));
        let mut b = account("b", 0.0, Some(NOW + 900));
        secondary(&mut a, 0.0, NOW + 2000);
        secondary(&mut b, 50.0, NOW + 1500);
        let no_secondary = account("no-secondary", 0.0, Some(NOW + 900));
        let mut expired_secondary = no_secondary.clone();
        expired_secondary.id = "expired-secondary".into();
        secondary(&mut expired_secondary, 100.0, NOW);
        let mut accounts = vec![no_secondary, a, expired_secondary, b];
        assert_eq!(evaluate_schedule(&accounts, None, NOW).decision.target_id(), Some("b"));
        secondary(&mut accounts[3], 0.0, NOW + 2000);
        assert_eq!(evaluate_schedule(&accounts, None, NOW).decision.target_id(), Some("a"));
        assert_eq!(evaluate_schedule(&accounts, Some("b"), NOW).decision, Decision::Keep);
    }

    #[test]
    fn all_exhausted_uses_latest_blocking_reset_per_account_then_earliest_recovery() {
        let mut both = account("both", 100.0, Some(NOW + 600));
        secondary(&mut both, 100.0, NOW + 2000);
        let mut long = account("long", 0.0, Some(NOW + 300));
        secondary(&mut long, 100.0, NOW + 1500);
        let accounts = vec![both, long, account("short", 100.0, Some(NOW + 1600))];
        let plan = evaluate_schedule(&accounts, Some("both"), NOW);
        assert_eq!(plan.decision, Decision::NoUsableAccounts {
            earliest_recovery_at: Some(NOW + 1500), fallback_account_id: None,
        });
        assert!(plan.status.all_exhausted);
        assert!(plan.status.next.is_none());
        assert_eq!(plan.status.earliest_recovery_at, Some(NOW + 1500));
        assert_eq!(evaluate_schedule(&accounts, None, NOW).decision, Decision::NoUsableAccounts {
            earliest_recovery_at: Some(NOW + 1500), fallback_account_id: Some("long".into()),
        });
        let plan = evaluate_schedule(&accounts, Some("both"), NOW + 1500);
        assert_eq!(plan.decision.target_id(), Some("long"));
        assert!(!plan.status.all_exhausted);
    }

    #[test]
    fn ineligible_current_falls_back_to_earliest_recovering_subscription() {
        let mut disabled = account("disabled", 0.0, Some(NOW + 100));
        disabled.enabled = false;
        let mut api = account("api", 0.0, Some(NOW + 100));
        api.account_type = AccountType::OpenaiApiKey;
        let accounts = vec![disabled, api, account("later", 100.0, Some(NOW + 1000)),
            account("sooner", 100.0, Some(NOW + 600))];
        for current in [None, Some("disabled"), Some("api"), Some("deleted")] {
            assert_eq!(evaluate_schedule(&accounts, current, NOW).decision, Decision::NoUsableAccounts {
                earliest_recovery_at: Some(NOW + 600), fallback_account_id: Some("sooner".into()),
            });
        }
        for current in [Some("later"), Some("sooner")] {
            assert!(evaluate_schedule(&accounts, current, NOW).decision.target_id().is_none());
        }
    }

    #[test]
    fn no_eligible_accounts_keeps_current_without_claiming_exhaustion() {
        let mut api = account("api", 0.0, None);
        api.account_type = AccountType::OpenaiApiKey;
        for current in [None, Some("api")] {
            let plan = evaluate_schedule(&[api.clone()], current, NOW);
            assert_eq!(plan.decision, Decision::NoUsableAccounts {
                earliest_recovery_at: None, fallback_account_id: None,
            });
            assert!(!plan.status.all_exhausted);
        }
    }

    #[test]
    fn requests_skip_while_an_evaluation_is_running() {
        let mut state = EvaluationState::default();
        assert!(state.request());
        for _ in 0..10 { assert!(!state.request()); }
        state.finish(false);
        assert!(!state.running);
        assert!(state.request());
    }

    #[test]
    fn cooldown_excludes_targets_but_preserves_current_availability() {
        let store = AccountStore {
            active_account_id: Some("current".into()),
            accounts: vec![account("current", 0.0, Some(NOW + 1800)),
                account("target", 0.0, Some(NOW + 900)), account("later", 0.0, Some(NOW + 1200))],
        };
        let excluded = HashSet::from(["target".to_string(), "current".to_string()]);
        assert_eq!(evaluate_candidates(&store, &excluded, NOW).decision.target_id(), Some("later"));
        let excluded = HashSet::from(["target".into(), "later".into(), "current".into()]);
        assert_eq!(evaluate_candidates(&store, &excluded, NOW).decision, Decision::Keep);
    }

    fn assert_local_time(value: &serde_json::Value, timestamp: i64) {
        let text = value.as_str().unwrap();
        let parsed = chrono::DateTime::parse_from_rfc3339(text).unwrap();
        assert_eq!(parsed.timestamp(), timestamp);
        assert_eq!(parsed.timestamp_subsec_nanos(), 0);
        assert_eq!(parsed.offset(), chrono::DateTime::from_timestamp(timestamp, 0).unwrap()
            .with_timezone(&Local).offset());
        assert!(!text.contains('.'));
    }

    #[test]
    fn agent_status_masks_names_reports_both_windows_and_uses_schedule_successor() {
        let mut current = account("current", 63.4, Some(NOW + 1800));
        secondary(&mut current, 20.4, NOW + 10_000);
        let mut successor = account("successor", 5.0, Some(NOW + 60));
        successor.name = "next@example.invalid".into();
        let store = AccountStore {
            active_account_id: Some("current".into()),
            accounts: vec![current, account("later", 0.0, Some(NOW + 900)), successor],
        };
        let status = serde_json::to_value(agent_status(&store, NOW)).unwrap();
        let current = &status["current"];
        assert_eq!(current.as_object().unwrap().len(), 6);
        assert_eq!(current["name"], "t***t@example.invalid");
        assert_eq!(current["usable"], true);
        assert_eq!(current["shortRemainingPercent"], 37);
        assert_eq!(current["longRemainingPercent"], 80);
        assert_local_time(&current["shortResetsAt"], NOW + 1800);
        assert_local_time(&current["longResetsAt"], NOW + 10_000);
        assert_eq!(status["next"]["name"], "n***t@example.invalid");
        assert_eq!(status["next"]["usable"], true);
        assert_eq!(status["next"]["shortRemainingPercent"], 95);
        assert_local_time(&status["next"]["shortResetsAt"], NOW + 60);
        assert_eq!(status["next"]["longRemainingPercent"], 100);
        assert!(status["next"]["longResetsAt"].is_null());
        assert_eq!(status["allExhausted"], false);
        assert!(status["earliestRecoveryAt"].is_null());
    }

    #[test]
    fn agent_status_reports_exhaustion_and_earliest_full_recovery() {
        let mut current = account("current", 100.0, Some(NOW + 600));
        secondary(&mut current, 100.0, NOW + 1200);
        let store = AccountStore {
            active_account_id: Some("current".into()),
            accounts: vec![current, account("sooner", 100.0, Some(NOW + 900))],
        };
        let status = serde_json::to_value(agent_status(&store, NOW)).unwrap();
        assert_eq!(status["current"]["usable"], false);
        assert_eq!(status["current"]["shortRemainingPercent"], 0);
        assert_eq!(status["current"]["longRemainingPercent"], 0);
        assert!(status["next"].is_null());
        assert_eq!(status["allExhausted"], true);
        assert_local_time(&status["earliestRecoveryAt"], NOW + 900);
    }

    #[test]
    fn agent_status_handles_missing_accounts_and_expired_windows_and_flattens_switch_result() {
        for id in [None, Some("deleted".into())] {
            let store = AccountStore { active_account_id: id, accounts: vec![] };
            assert_eq!(serde_json::to_value(agent_status(&store, NOW)).unwrap(), serde_json::json!({
                "current": null, "next": null, "allExhausted": false, "earliestRecoveryAt": null
            }));
        }
        let mut current = account("current", 100.0, Some(NOW));
        secondary(&mut current, 100.0, NOW - 1);
        let store = AccountStore { active_account_id: Some("current".into()), accounts: vec![current] };
        let result = serde_json::to_value(SwitchResult { switched: false, status: agent_status(&store, NOW) }).unwrap();
        assert_eq!(result.as_object().unwrap().len(), 5);
        assert_eq!(result["switched"], false);
        assert_eq!(result["current"]["usable"], true);
        assert_eq!(result["current"]["shortRemainingPercent"], 100);
        assert_eq!(result["current"]["longRemainingPercent"], 100);
        assert!(result["current"]["shortResetsAt"].is_null());
        assert!(result["current"]["longResetsAt"].is_null());
    }
}
