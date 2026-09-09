use crate::auth::{
    apply_auth_json, can_apply_auth_json, decode_access_token, exchange_rt_for_at,
    extract_personal_access_token, oauth_auth_identity, update_oauth_auth_json,
    PersonalAccessTokenMetadata, RtTokenInfo, PERSONAL_ACCESS_TOKEN_METADATA_URL,
};
use crate::http::curl_get_json;
use crate::sessions::sync::request_session_sync;
use crate::state::AppState;
use crate::time::{rfc3339_timestamp_millis, timestamp_is_not_after};
use chrono::DateTime;
use chrono::Utc;
use rusqlite::params;
use rusqlite::Connection;
use rusqlite::OptionalExtension;
use serde::Deserialize;
use serde::Serialize;
use tauri::Emitter;
use tauri::State;

/// 会话感知到的额度快照（token_count 事件随模型请求顺带返回的 rate_limits）。
/// 短周期（primary，通常 5 小时）字段平铺；长周期（secondary，周限/月限）整体带出，
/// 事件里为 null（如老版本只有单一窗口）时为 None。
#[derive(Debug, Clone, Default)]
pub(crate) struct RateLimitSnapshot {
    pub(crate) used_percent: f64,
    pub(crate) window_minutes: Option<i64>,
    pub(crate) resets_at: Option<i64>,
    /// 长周期额度（周限/月限），供剩余额度展示同步。
    pub(crate) secondary: Option<AccountUsageWindow>,
    pub(crate) plan_type: Option<String>,
    /// 事件时间戳（用于归属账号时段）。
    pub(crate) timestamp: String,
}

const CODEX_USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";

const USAGE_RESET_FALLBACK_SECONDS: i64 = 5 * 60;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct AccountUsageWindow {
    #[serde(rename = "usedPercent")]
    pub(crate) used_percent: Option<f64>,
    #[serde(rename = "windowMinutes")]
    pub(crate) window_minutes: Option<i64>,
    #[serde(rename = "resetsAt")]
    pub(crate) resets_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct AccountUsage {
    pub(crate) primary: Option<AccountUsageWindow>,
    pub(crate) secondary: Option<AccountUsageWindow>,
    #[serde(rename = "syncedAt")]
    pub(crate) synced_at: String,
    #[serde(
        default,
        rename = "requestStartedAt",
        skip_serializing_if = "Option::is_none"
    )]
    pub(crate) request_started_at: Option<String>,
    /// 额度接口返回的订阅类型，仅内部用于更新账号 chatgpt_plan_type，不序列化。
    #[serde(skip)]
    pub(crate) plan_type: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UsageApiResponse {
    #[serde(default)]
    rate_limit: Option<UsageRateLimitDetails>,
    /// 额度接口返回的订阅类型（如 plus/pro/team）。
    #[serde(default)]
    plan_type: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UsageRateLimitDetails {
    #[serde(default)]
    primary_window: Option<UsageApiWindow>,
    #[serde(default)]
    secondary_window: Option<UsageApiWindow>,
}

#[derive(Debug, Deserialize)]
struct UsageApiWindow {
    used_percent: f64,
    #[serde(default)]
    limit_window_seconds: Option<i64>,
    #[serde(default)]
    reset_at: Option<i64>,
}

pub(crate) fn parse_cached_usage(usage_json: Option<String>) -> Option<AccountUsage> {
    usage_json.and_then(|content| serde_json::from_str(&content).ok())
}

fn normalize_usage_window(window: UsageApiWindow) -> AccountUsageWindow {
    AccountUsageWindow {
        used_percent: Some(window.used_percent),
        window_minutes: window.limit_window_seconds.map(|seconds| seconds / 60),
        resets_at: window.reset_at,
    }
}

/// 解析账号额度请求用的 bearer、账号 ID、FedRAMP 与是否允许 whoami：
/// - 优先 Personal Access Token（PAT）：team 等账号的 auth.json 可同时持有 pat/rt/at，
///   有 PAT 一律用 PAT（account_id 运行时经 whoami 获取）；
/// - 无 PAT（OAuth / rt 账号）：用 at + 存库 account_id（跳过 whoami，whoami 拒绝 at）。
pub(crate) fn account_usage_context(
    auth_json_content: &str,
    access_token: Option<&str>,
    refresh_token: Option<&str>,
    chatgpt_account_id: Option<&str>,
    chatgpt_account_is_fedramp: bool,
) -> (Option<String>, Option<String>, bool, bool) {
    if let Some(pat) = extract_personal_access_token(auth_json_content) {
        return (Some(pat), None, false, true);
    }
    if access_token.is_some() && refresh_token.is_some() {
        return (
            access_token.map(str::to_string),
            chatgpt_account_id.map(str::to_string),
            chatgpt_account_is_fedramp,
            false,
        );
    }
    (None, None, false, true)
}

pub(crate) fn fetch_account_usage(
    bearer: &str,
    account_id: Option<&str>,
    is_fedramp: bool,
    needs_whoami: bool,
) -> Result<AccountUsage, String> {
    let (account_id, is_fedramp) = if let Some(id) = account_id {
        (Some(id.to_string()), is_fedramp)
    } else if needs_whoami {
        let metadata = curl_get_json::<PersonalAccessTokenMetadata>(
            PERSONAL_ACCESS_TOKEN_METADATA_URL,
            bearer,
            None,
            false,
        )
        .map_err(|error| format!("Token 校验失败：{error}"))?;
        (
            Some(metadata.chatgpt_account_id),
            metadata.chatgpt_account_is_fedramp,
        )
    } else {
        // rt 账号且无存库 account_id：不带 ChatGPT-Account-ID 头。
        (None, is_fedramp)
    };

    let request_started_at = Utc::now().to_rfc3339();
    let response = curl_get_json::<UsageApiResponse>(
        CODEX_USAGE_URL,
        bearer,
        account_id.as_deref(),
        is_fedramp,
    )
    .map_err(|error| format!("额度刷新失败：{error}"))?;

    let (primary, secondary) = match response.rate_limit {
        Some(details) => (
            details.primary_window.map(normalize_usage_window),
            details.secondary_window.map(normalize_usage_window),
        ),
        None => (None, None),
    };
    Ok(AccountUsage {
        primary,
        secondary,
        synced_at: Utc::now().to_rfc3339(),
        request_started_at: Some(request_started_at),
        plan_type: response.plan_type,
    })
}

/// 成功和失败都按短周期重置时间加一分钟安排刷新。
fn compute_next_refresh_at(usage: &AccountUsage, now: DateTime<Utc>) -> DateTime<Utc> {
    usage
        .primary
        .as_ref()
        .and_then(|window| window.resets_at)
        .filter(|reset| *reset > 0)
        .and_then(|reset| DateTime::from_timestamp(reset, 0))
        .and_then(|reset| reset.checked_add_signed(chrono::Duration::minutes(1)))
        .filter(|next| *next > now)
        .unwrap_or(now + chrono::Duration::seconds(USAGE_RESET_FALLBACK_SECONDS + 60))
}

pub(crate) fn report_account_request_error(
    app: &tauri::AppHandle,
    state: &AppState,
    id: &str,
    title: &str,
    error: &str,
) {
    let name = state.db.lock().ok().and_then(|db| {
        db.query_row(
            "SELECT name FROM accounts WHERE id = ?1",
            params![id],
            |row| row.get::<_, String>(0),
        ).ok()
    }).unwrap_or_else(|| id.to_string());
    let _ = app.emit(
        "account-request-failed",
        serde_json::json!({ "accountName": name, "message": format!("{title}：{error}\n请手动检查账号认证或网络后处理。") }),
    );
}

/// 获取失败时只把重置时间写为五分钟后，额度百分比保留已有值。
pub(crate) fn save_fallback_reset(
    app: &tauri::AppHandle,
    state: &AppState,
    id: &str,
    title: &str,
    error: &str,
) {
    let saved = (|| -> Result<(), String> {
        let db = state.db.lock().map_err(|error| error.to_string())?;
        let cached = db.query_row(
            "SELECT usage_json FROM accounts WHERE id = ?1",
            params![id],
            |row| row.get::<_, Option<String>>(0),
        ).map_err(|error| error.to_string())?;
        let now = Utc::now();
        let mut usage = parse_cached_usage(cached).unwrap_or(AccountUsage {
            primary: None,
            secondary: None,
            synced_at: now.to_rfc3339(),
            request_started_at: None,
            plan_type: None,
        });
        let primary = usage.primary.get_or_insert(AccountUsageWindow {
            used_percent: None,
            window_minutes: None,
            resets_at: None,
        });
        primary.resets_at = Some(
            (now + chrono::Duration::seconds(USAGE_RESET_FALLBACK_SECONDS)).timestamp(),
        );
        usage.synced_at = now.to_rfc3339();
        usage.request_started_at = None;
        let json = serde_json::to_string(&usage).map_err(|error| error.to_string())?;
        let next = compute_next_refresh_at(&usage, now).to_rfc3339();
        db.execute(
            "UPDATE accounts SET usage_json = ?1, usage_updated_at = ?2, next_refresh_at = ?3 WHERE id = ?4",
            params![json, usage.synced_at, next, id],
        ).map_err(|error| error.to_string())?;
        Ok(())
    })();
    let message = match saved {
        Ok(()) => error.to_string(),
        Err(save_error) => format!("{error}\n默认重置时间保存失败：{save_error}"),
    };
    report_account_request_error(app, state, id, title, &message);
    let _ = app.emit(
        "usage-updated",
        AccountRefreshEvent { account_id: id.to_string() },
    );
}

/// 根据额度响应的长周期（secondary）窗口时长推导账号限额类型（周限/月限）。
/// 10080 分钟 = 7 天 → 周限；38880~46080 分钟 ≈ 30 天 → 月限。
fn derive_plan_type_from_usage(usage: &AccountUsage) -> Option<&'static str> {
    let secondary = usage.secondary.as_ref()?;
    let minutes = secondary.window_minutes?;
    if minutes == 10_080 {
        Some("weekly")
    } else if (38_880..=46_080).contains(&minutes) {
        Some("monthly")
    } else {
        None
    }
}

fn persist_account_usage(
    db: &Connection,
    account_id: &str,
    expected_token: &str,
    usage: &AccountUsage,
) -> Result<(), String> {
    let tx = db.unchecked_transaction().map_err(|e| e.to_string())?;
    persist_account_usage_inner(&tx, account_id, expected_token, usage)?;
    tx.commit().map_err(|e| e.to_string())
}

fn persist_account_usage_inner(
    db: &Connection,
    account_id: &str,
    expected_token: &str,
    usage: &AccountUsage,
) -> Result<(), String> {
    let (auth_json_content, existing_plan_type, stored_access_token, existing_chatgpt_plan_type) = db
        .query_row(
            "SELECT auth_json_content, plan_type, access_token, chatgpt_plan_type FROM accounts WHERE id = ?1",
            params![account_id],
            |row| Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
            )),
        )
        .map_err(|_| "Account not found".to_string())?;
    // PAT 账号按 PAT 校验；rt 账号（无 PAT）按 access_token（at）校验。
    let auth_ok = if extract_personal_access_token(&auth_json_content).is_some() {
        extract_personal_access_token(&auth_json_content).as_deref() == Some(expected_token)
    } else {
        stored_access_token.as_deref() == Some(expected_token)
    };
    if !auth_ok {
        return Err("账号认证已变更，请重新刷新额度".to_string());
    }

    let updated_at: Option<String> = db
        .query_row(
            "SELECT usage_updated_at FROM accounts WHERE id = ?1",
            params![account_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    // 请求期间已收到 session 额度时，响应的服务端取样顺序无法确定。
    // 保留 session 的准确观测，避免延迟响应制造一次假重置。
    if let (Some(started), Some(last)) =
        (usage.request_started_at.as_deref(), updated_at.as_deref())
    {
        if timestamp_is_not_after(started, last) && !timestamp_is_not_after(&usage.synced_at, last)
        {
            return Ok(());
        }
    }
    if updated_at
        .as_deref()
        .map(|last| timestamp_is_not_after(&usage.synced_at, last))
        .unwrap_or(false)
    {
        return Ok(());
    }

    let usage_json = serde_json::to_string(usage).map_err(|e| e.to_string())?;
    let next_refresh_at = compute_next_refresh_at(usage, Utc::now()).to_rfc3339();
    let plan_type = match derive_plan_type_from_usage(usage) {
        Some(plan) => plan.to_string(),
        None => existing_plan_type,
    };
    // 额度接口返回的订阅类型可补全账号的 chatgpt_plan_type（如 rt 账号首次刷新后）。
    let chatgpt_plan_type = usage
        .plan_type
        .as_deref()
        .map(str::trim)
        .filter(|plan| !plan.is_empty())
        .map(str::to_string)
        .or(existing_chatgpt_plan_type);
    let rows_affected = db
        .execute(
            "UPDATE accounts SET usage_json = ?1, usage_updated_at = ?2, next_refresh_at = ?3, plan_type = ?4, chatgpt_plan_type = ?5 WHERE id = ?6",
            params![usage_json, usage.synced_at, next_refresh_at, plan_type, chatgpt_plan_type.as_deref(), account_id],
        )
        .map_err(|e| e.to_string())?;

    if rows_affected == 0 {
        return Err("Account not found".to_string());
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct AccountRefreshEvent {
    #[serde(rename = "accountId")]
    pub(crate) account_id: String,
}

/// at 是否临近/已过期（需用 rt 刷新）。
pub(crate) fn at_is_due(at_expires_at: &Option<String>) -> bool {
    let Some(value) = at_expires_at else {
        return false;
    };
    let Ok(expires) = DateTime::parse_from_rfc3339(value) else {
        return false;
    };
    expires.with_timezone(&Utc) <= Utc::now() + chrono::Duration::minutes(5)
}

pub(crate) struct AccountRefreshGuard<'a> {
    state: &'a AppState,
    account_id: String,
    app: Option<tauri::AppHandle>,
}

impl Drop for AccountRefreshGuard<'_> {
    fn drop(&mut self) {
        remove_from_refreshing(self.state, &self.account_id);
        if let Some(app) = &self.app {
            let _ = app.emit(
                "usage-refresh-finished",
                AccountRefreshEvent {
                    account_id: self.account_id.clone(),
                },
            );
        }
    }
}

pub(crate) fn begin_account_refresh<'a>(
    state: &'a AppState,
    id: &str,
    app: Option<tauri::AppHandle>,
) -> Result<AccountRefreshGuard<'a>, String> {
    if !state
        .refreshing
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id.to_string())
    {
        return Err("该账号正在刷新，请稍候。".to_string());
    }
    if let Some(app) = &app {
        let _ = app.emit(
            "usage-refresh-started",
            AccountRefreshEvent {
                account_id: id.to_string(),
            },
        );
    }
    let guard = AccountRefreshGuard {
        state,
        account_id: id.to_string(),
        app,
    };
    let db = state.db.lock().map_err(|e| e.to_string())?;
    sync_active_oauth_account(&db)?;
    Ok(guard)
}

/// Codex 也会续期；回读同一账号的新凭证后再使用数据库中的 rt。
pub(crate) fn sync_active_oauth_account(db: &Connection) -> Result<(), String> {
    let active = db
        .query_row(
            "SELECT id, auth_json_content, refresh_token FROM accounts WHERE is_active = 1 AND refresh_token IS NOT NULL",
            [],
            |row| Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            )),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((id, content, expected_rt)) = active else {
        return Ok(());
    };
    if extract_personal_access_token(&content).is_some() {
        return Ok(());
    }
    let auth_path = crate::codex::paths::codex_home()?.join("auth.json");
    let Ok(local_content) = std::fs::read_to_string(auth_path) else {
        return Ok(());
    };
    if !can_apply_auth_json(&local_content) || extract_personal_access_token(&local_content).is_some() {
        return Ok(());
    }
    let stored: serde_json::Value = serde_json::from_str(&content)
        .map_err(|_| "保存的账号登录信息格式异常，请重新登录。".to_string())?;
    let local: serde_json::Value = serde_json::from_str(&local_content)
        .map_err(|_| "本地账号登录信息格式异常，请重新登录。".to_string())?;
    let Some(identity) = oauth_auth_identity(&stored) else {
        return Ok(());
    };
    if oauth_auth_identity(&local).as_ref() != Some(&identity) {
        return Ok(());
    }
    let tokens = &local["tokens"];
    let access_token = tokens["access_token"].as_str().unwrap_or_default();
    let refresh_token = tokens["refresh_token"].as_str().unwrap_or_default();
    if refresh_token == expected_rt {
        return Ok(());
    }
    let Some((meta, exp)) = decode_access_token(access_token) else {
        return Ok(());
    };
    let stored_exp = stored["tokens"]["access_token"]
        .as_str()
        .and_then(decode_access_token)
        .map(|(_, exp)| exp)
        .unwrap_or_default();
    let local_refreshed_at = local["last_refresh"]
        .as_str()
        .and_then(rfc3339_timestamp_millis);
    let stored_refreshed_at = stored["last_refresh"]
        .as_str()
        .and_then(rfc3339_timestamp_millis);
    if exp < stored_exp || (exp == stored_exp && local_refreshed_at <= stored_refreshed_at) {
        return Ok(());
    }
    persist_rotated_access_token(
        db,
        &id,
        &expected_rt,
        &RtTokenInfo {
            email: meta.email,
            chatgpt_plan_type: meta.chatgpt_plan_type,
            chatgpt_account_id: Some(identity.0),
            id_token: tokens["id_token"].as_str().map(str::to_string),
            access_token: access_token.to_string(),
            refresh_token: refresh_token.to_string(),
            at_expires_at: exp,
        },
        false,
    )
}

pub(crate) fn persist_rotated_access_token(
    db: &Connection,
    id: &str,
    expected_rt: &str,
    info: &RtTokenInfo,
    write_local_auth: bool,
) -> Result<(), String> {
    let (content, is_active, account_id) = db
        .query_row(
            "SELECT auth_json_content, is_active, chatgpt_account_id FROM accounts WHERE id = ?1 AND refresh_token = ?2",
            params![id, expected_rt],
            |row| Ok((
                row.get::<_, String>(0)?,
                row.get::<_, bool>(1)?,
                row.get::<_, Option<String>>(2)?,
            )),
        )
        .map_err(|_| "账号认证已变更，请重新操作。".to_string())?;
    let is_oauth = extract_personal_access_token(&content).is_none();
    let auth_json_content = if is_oauth {
        let mut info = info.clone();
        info.chatgpt_account_id = info.chatgpt_account_id.or(account_id);
        update_oauth_auth_json(&content, &info)
    } else {
        content
    };
    let new_expiry = DateTime::from_timestamp(info.at_expires_at, 0).map(|time| time.to_rfc3339());
    let changed = db
        .execute(
            "UPDATE accounts SET access_token = ?1, refresh_token = ?2, at_expires_at = ?3,
             chatgpt_account_id = COALESCE(?4, chatgpt_account_id), reset_credits_json = NULL,
             auth_json_content = ?7
         WHERE id = ?5 AND refresh_token = ?6",
            params![
                info.access_token,
                info.refresh_token,
                new_expiry,
                info.chatgpt_account_id,
                id,
                expected_rt,
                auth_json_content
            ],
        )
        .map_err(|e| e.to_string())?;
    if changed != 1 {
        return Err("账号认证已变更，请重新操作。".to_string());
    }
    // 先保存已轮换的 rt；本地文件写入失败时也不能丢失新的凭证。
    if write_local_auth && is_active && is_oauth {
        if !can_apply_auth_json(&auth_json_content) {
            return Err("账号登录信息不完整，请重新进行 OAuth 登录。".to_string());
        }
        apply_auth_json(&auth_json_content)?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn refresh_account_usage(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<AccountUsage, String> {
    let _guard = begin_account_refresh(&state, &id, Some(app.clone())).map_err(|error| {
        report_account_request_error(&app, &state, &id, "额度刷新未执行", &error);
        error
    })?;
    refresh_account_usage_inner(&app, &state, &id).await
}

/// 调用者持有账号刷新互斥；激活消息与额度查询共用同一个互斥区间。
pub(crate) async fn refresh_account_usage_inner(
    app: &tauri::AppHandle,
    state: &AppState,
    id: &str,
) -> Result<AccountUsage, String> {
    let result = fetch_and_persist_account_usage(app, state, id).await;
    if let Err(error) = &result {
        save_fallback_reset(app, state, id, "额度刷新失败", error);
    }
    result
}

async fn fetch_and_persist_account_usage(
    app: &tauri::AppHandle,
    state: &AppState,
    id: &str,
) -> Result<AccountUsage, String> {
    // 读取账号认证上下文。
    let (
        auth_json_content,
        access_token,
        refresh_token,
        chatgpt_account_id,
        fedramp,
        at_expires_at,
    ) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.query_row(
            "SELECT auth_json_content, access_token, refresh_token, chatgpt_account_id, chatgpt_account_is_fedramp, at_expires_at FROM accounts WHERE id = ?1",
            params![id],
            |row| Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, i32>(4)? == 1,
                row.get::<_, Option<String>>(5)?,
            )),
        )
        .map_err(|_| "Account not found".to_string())?
    };

    let (mut bearer, mut account_id, mut fedramp, needs_whoami) = account_usage_context(
        &auth_json_content,
        access_token.as_deref(),
        refresh_token.as_deref(),
        chatgpt_account_id.as_deref(),
        fedramp,
    );

    // 无 PAT 的 rt 账号且 at 临近过期：先用 rt 兑换新 at（rt 一次性使用，保存新 rt）。
    // 有 PAT 的账号走 PAT，无需兑换，也不覆盖 bearer。
    if extract_personal_access_token(&auth_json_content).is_none()
        && refresh_token.is_some()
        && at_is_due(&at_expires_at)
    {
        if let Some(rt) = refresh_token {
            let expected_rt = rt.clone();
            let info = tauri::async_runtime::spawn_blocking(move || exchange_rt_for_at(&rt))
                .await
                .map_err(|e| format!("刷新 Access Token 任务失败：{e}"))??;
            {
                let db = state.db.lock().map_err(|e| e.to_string())?;
                persist_rotated_access_token(&db, &id, &expected_rt, &info, true)?;
            }
            bearer = Some(info.access_token);
            account_id = info.chatgpt_account_id;
            fedramp = false;
        }
    }

    let bearer = bearer.ok_or_else(|| "无可用认证信息".to_string())?;

    let fetch_result = tauri::async_runtime::spawn_blocking({
        let bearer = bearer.clone();
        let account_id = account_id.clone();
        move || fetch_account_usage(&bearer, account_id.as_deref(), fedramp, needs_whoami)
    })
    .await
    .map_err(|e| format!("额度刷新任务失败：{e}"));

    let usage = match fetch_result {
        Ok(Ok(usage)) => usage,
        Ok(Err(error)) => {
            return Err(error);
        }
        Err(error) => {
            return Err(error);
        }
    };

    let persist_result = (|| {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        persist_account_usage(&db, &id, &bearer, &usage)
    })();

    persist_result?;

    let _ = app.emit(
        "usage-updated",
        AccountRefreshEvent {
            account_id: id.to_string(),
        },
    );

    request_session_sync();
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let cached: String = db
        .query_row(
            "SELECT usage_json FROM accounts WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    serde_json::from_str(&cached).map_err(|e| e.to_string())
}

fn remove_from_refreshing(state: &AppState, id: &str) {
    if let Ok(mut refreshing) = state.refreshing.lock() {
        refreshing.remove(id);
    }
}

fn session_usage_is_valid(window: &AccountUsageWindow, timestamp_millis: i64) -> bool {
    let Some(used_percent) = window.used_percent else {
        return false;
    };
    if !used_percent.is_finite() || !(0.0..=100.0).contains(&used_percent) {
        return false;
    }
    let Some(end) = window.resets_at.filter(|end| *end > 0) else {
        return false;
    };
    timestamp_millis < end.saturating_mul(1000)
        && window
            .window_minutes
            .filter(|minutes| *minutes > 0)
            .map(|minutes| {
                timestamp_millis
                    >= end
                        .saturating_sub(minutes.saturating_mul(60))
                        .saturating_mul(1000)
            })
            .unwrap_or(true)
}

/// 用会话感知的额度快照更新账号的剩余额度：
/// - 合并现有 usage_json：更新 primary 与 secondary（事件缺 secondary 时保留旧值）及同步时间；
/// - 会话感知到订阅类型时顺带补全 chatgpt_plan_type；
/// - 依据最新窗口更新 next_refresh_at；
/// 返回是否实际写入（时间保护跳过旧事件时为 false），
/// 供同步结束后通知前端刷新对应账号的额度展示。
pub(crate) fn update_account_usage_from_session(
    tx: &rusqlite::Transaction<'_>,
    account_id: &str,
    rl: &RateLimitSnapshot,
) -> Result<bool, String> {
    let primary = AccountUsageWindow {
        used_percent: Some(rl.used_percent),
        window_minutes: rl.window_minutes,
        resets_at: rl.resets_at,
    };
    if !rfc3339_timestamp_millis(&rl.timestamp)
        .map(|ts| session_usage_is_valid(&primary, ts))
        .unwrap_or(false)
    {
        return Ok(false);
    }
    // 历史会话不能覆盖账号卡片上更新的额度缓存。
    let usage_updated_at: Option<String> = tx
        .query_row(
            "SELECT usage_updated_at FROM accounts WHERE id = ?1",
            params![account_id],
            |row| row.get(0),
        )
        .ok()
        .flatten();
    if let Some(last) = usage_updated_at {
        if !last.is_empty() && timestamp_is_not_after(&rl.timestamp, &last) {
            return Ok(false);
        }
    }

    let existing: Option<String> = tx
        .query_row(
            "SELECT usage_json FROM accounts WHERE id = ?1",
            params![account_id],
            |row| row.get(0),
        )
        .ok();
    let mut usage = existing
        .and_then(|json| serde_json::from_str::<AccountUsage>(&json).ok())
        .unwrap_or_else(|| AccountUsage {
            request_started_at: None,
            primary: None,
            secondary: None,
            synced_at: rl.timestamp.clone(),
            plan_type: None,
        });
    usage.primary = Some(primary);
    // 长周期窗口（周限/月限）：事件带 secondary 时一并更新，否则保留既有缓存。
    // 只更新 primary 会让周额度停在上次手动/启动刷新的旧值，而 syncedAt 却在前进。
    if let Some(secondary) = rl.secondary.clone() {
        usage.secondary = Some(secondary);
    }
    usage.synced_at = rl.timestamp.clone();
    usage.request_started_at = None;
    let json = serde_json::to_string(&usage).map_err(|e| e.to_string())?;
    let observed_at = DateTime::parse_from_rfc3339(&rl.timestamp)
        .map_err(|error| error.to_string())?
        .with_timezone(&Utc);
    let next_refresh_at = compute_next_refresh_at(&usage, observed_at).to_rfc3339();
    tx.execute(
        "UPDATE accounts SET usage_json = ?1, usage_updated_at = ?2, chatgpt_plan_type = COALESCE(?3, chatgpt_plan_type), next_refresh_at = ?4 WHERE id = ?5",
        params![json, rl.timestamp, rl.plan_type, next_refresh_at, account_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_db;
    use crate::test_support::{usage, utc_ts};
    use serde_json::Value;

    #[test]
    fn not_exhausted_without_reset_uses_default_reset_plus_minute() {
        let now = utc_ts("2026-08-07T10:00:00Z");
        let next = compute_next_refresh_at(&usage(40.0, None), now);
        assert_eq!(next, utc_ts("2026-08-07T10:06:00Z"));
    }

    #[test]
    fn exhausted_with_future_reset_uses_reset_plus_minute() {
        let now = utc_ts("2026-08-07T10:00:00Z");
        let resets_at = now.timestamp() + 600; // 10:10
        let next = compute_next_refresh_at(&usage(100.0, Some(resets_at)), now);
        assert_eq!(next, utc_ts("2026-08-07T10:11:00Z"));
    }

    #[test]
    fn exhausted_without_reset_uses_default_reset_plus_minute() {
        let now = utc_ts("2026-08-07T10:00:00Z");
        let next = compute_next_refresh_at(&usage(100.0, None), now);
        assert_eq!(next, utc_ts("2026-08-07T10:06:00Z"));
    }

    #[test]
    fn exhausted_with_past_reset_uses_default_reset_plus_minute() {
        let now = utc_ts("2026-08-07T10:00:00Z");
        let resets_at = now.timestamp() - 600; // 已过
        let next = compute_next_refresh_at(&usage(100.0, Some(resets_at)), now);
        assert_eq!(next, utc_ts("2026-08-07T10:06:00Z"));
    }

    #[test]
    fn missing_primary_uses_default_reset_plus_minute() {
        let now = utc_ts("2026-08-07T10:00:00Z");
        let usage = AccountUsage {
            request_started_at: None,
            primary: None,
            secondary: None,
            synced_at: "2026-08-07T10:00:00Z".to_string(),
            plan_type: None,
        };
        let next = compute_next_refresh_at(&usage, now);
        assert_eq!(next, utc_ts("2026-08-07T10:06:00Z"));
    }

    #[test]
    fn derive_plan_weekly() {
        let usage = AccountUsage {
            request_started_at: None,
            primary: Some(AccountUsageWindow {
                used_percent: Some(30.0),
                window_minutes: Some(300),
                resets_at: None,
            }),
            secondary: Some(AccountUsageWindow {
                used_percent: Some(50.0),
                window_minutes: Some(10_080),
                resets_at: None,
            }),
            synced_at: "2026-08-07T10:00:00Z".to_string(),
            plan_type: None,
        };
        assert_eq!(derive_plan_type_from_usage(&usage), Some("weekly"));
    }

    #[test]
    fn derive_plan_monthly() {
        let usage = AccountUsage {
            request_started_at: None,
            primary: None,
            secondary: Some(AccountUsageWindow {
                used_percent: Some(50.0),
                window_minutes: Some(43_200),
                resets_at: None,
            }),
            synced_at: "2026-08-07T10:00:00Z".to_string(),
            plan_type: None,
        };
        assert_eq!(derive_plan_type_from_usage(&usage), Some("monthly"));
    }

    #[test]
    fn derive_plan_unknown_returns_none() {
        let usage = AccountUsage {
            request_started_at: None,
            primary: None,
            secondary: Some(AccountUsageWindow {
                used_percent: Some(50.0),
                window_minutes: Some(300),
                resets_at: None,
            }),
            synced_at: "2026-08-07T10:00:00Z".to_string(),
            plan_type: None,
        };
        assert_eq!(derive_plan_type_from_usage(&usage), None);
    }

    #[test]
    fn persist_writes_next_refresh_at() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE accounts (
                id TEXT PRIMARY KEY,
                auth_json_content TEXT NOT NULL,
                usage_json TEXT,
                usage_updated_at TEXT,
                next_refresh_at TEXT,
                plan_type TEXT NOT NULL DEFAULT 'weekly',
                chatgpt_plan_type TEXT,
                access_token TEXT
            )",
        )
        .unwrap();
        let auth = r#"{"personal_access_token": "sk-test-token"}"#;
        conn.execute(
            "INSERT INTO accounts (id, auth_json_content) VALUES (?1, ?2)",
            params!["a1", auth],
        )
        .unwrap();

        let now = Utc::now();
        let resets_at = now.timestamp() + 600;
        let usage = AccountUsage {
            request_started_at: None,
            primary: Some(AccountUsageWindow {
                used_percent: Some(100.0),
                window_minutes: Some(300),
                resets_at: Some(resets_at),
            }),
            secondary: None,
            synced_at: now.to_rfc3339(),
            plan_type: None,
        };

        persist_account_usage(&conn, "a1", "sk-test-token", &usage).unwrap();

        let expected = (DateTime::from_timestamp(resets_at, 0).unwrap()
            + chrono::Duration::seconds(60))
        .to_rfc3339();
        let next: Option<String> = conn
            .query_row(
                "SELECT next_refresh_at FROM accounts WHERE id = 'a1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(next.as_deref(), Some(expected.as_str()));
    }

    #[test]
    fn session_usage_update_merges_and_updates_schedule() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE accounts (
                id TEXT PRIMARY KEY,
                usage_json TEXT,
                usage_updated_at TEXT,
                next_refresh_at TEXT,
                chatgpt_plan_type TEXT
            );",
        )
        .unwrap();
        // 已有 wham 缓存（含 secondary）+ 调度计划。
        let existing = serde_json::json!({
            "primary": { "usedPercent": 55.0, "windowMinutes": 10080, "resetsAt": 1787134079 },
            "secondary": { "usedPercent": 30.0, "windowMinutes": 300, "resetsAt": 1787134000 },
            "syncedAt": "2026-08-13T10:00:00Z"
        })
        .to_string();
        conn.execute(
            "INSERT INTO accounts (id, usage_json, usage_updated_at, next_refresh_at, chatgpt_plan_type) VALUES ('acc-a', ?1, '2026-08-13T10:00:00Z', '2026-08-13T11:00:00Z', NULL)",
            params![existing],
        )
        .unwrap();

        let rl = RateLimitSnapshot {
            used_percent: 71.0,
            window_minutes: Some(10080),
            resets_at: Some(1787134079),
            secondary: None,
            plan_type: Some("team".to_string()),
            timestamp: "2026-08-14T03:20:00Z".to_string(),
        };
        let tx = conn.transaction().unwrap();
        update_account_usage_from_session(&tx, "acc-a", &rl).unwrap();
        tx.commit().unwrap();

        let (json, next_refresh, plan): (String, Option<String>, Option<String>) = conn
            .query_row(
                "SELECT usage_json, next_refresh_at, chatgpt_plan_type FROM accounts WHERE id = 'acc-a'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        let usage: Value = serde_json::from_str(&json).unwrap();
        // primary 更新为会话感知值。
        assert_eq!(usage["primary"]["usedPercent"], 71.0);
        // secondary 保留（合并而非覆盖）。
        assert_eq!(usage["secondary"]["usedPercent"], 30.0);
        assert_eq!(usage["syncedAt"], "2026-08-14T03:20:00Z");
        // 根据最新重置时间安排刷新。
        let expected = (DateTime::from_timestamp(1787134079, 0).unwrap()
            + chrono::Duration::minutes(1)).to_rfc3339();
        assert_eq!(next_refresh.as_deref(), Some(expected.as_str()));
        // 订阅类型顺带补全。
        assert_eq!(plan.as_deref(), Some("team"));
    }

    #[test]
    fn session_usage_update_writes_secondary_window() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE accounts (
                id TEXT PRIMARY KEY,
                usage_json TEXT,
                usage_updated_at TEXT,
                next_refresh_at TEXT,
                chatgpt_plan_type TEXT
            );",
        )
        .unwrap();
        // 旧缓存里的周限是启动刷新时的陈旧值。
        let existing = serde_json::json!({
            "primary": { "usedPercent": 20.0, "windowMinutes": 300, "resetsAt": 1787726223 },
            "secondary": { "usedPercent": 3.0, "windowMinutes": 10080, "resetsAt": 1788313023 },
            "syncedAt": "2026-08-26T01:00:00Z"
        })
        .to_string();
        conn.execute(
            "INSERT INTO accounts (id, usage_json, usage_updated_at) VALUES ('acc-a', ?1, '2026-08-26T01:00:00Z')",
            params![existing],
        )
        .unwrap();

        let rl = RateLimitSnapshot {
            used_percent: 94.0,
            window_minutes: Some(300),
            resets_at: Some(1787726207),
            secondary: Some(AccountUsageWindow {
                used_percent: Some(15.0),
                window_minutes: Some(10_080),
                resets_at: Some(1788313007),
            }),
            plan_type: Some("team".to_string()),
            timestamp: "2026-08-26T03:45:48Z".to_string(),
        };
        let tx = conn.transaction().unwrap();
        update_account_usage_from_session(&tx, "acc-a", &rl).unwrap();
        tx.commit().unwrap();

        let json: String = conn
            .query_row(
                "SELECT usage_json FROM accounts WHERE id = 'acc-a'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let usage: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(usage["primary"]["usedPercent"], 94.0);
        assert_eq!(usage["primary"]["windowMinutes"], 300);
        // 周限随会话同步一起更新（此前会停留在 3.0）。
        assert_eq!(usage["secondary"]["usedPercent"], 15.0);
        assert_eq!(usage["secondary"]["windowMinutes"], 10080);
        assert_eq!(usage["secondary"]["resetsAt"], 1788313007i64);
        assert_eq!(usage["syncedAt"], "2026-08-26T03:45:48Z");
    }

    #[test]
    fn old_api_response_cannot_overwrite_newer_usage() {
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();
        conn.execute(
            "INSERT INTO accounts (id, name, auth_json_content, created_at, updated_at, is_active)
             VALUES ('a', 'fixture', ?1, '1970-01-01T00:00:00Z', '1970-01-01T00:00:00Z', 0)",
            params![r#"{"personal_access_token":"fixture-token"}"#],
        )
        .unwrap();
        let current = AccountUsage {
            request_started_at: None,
            primary: Some(AccountUsageWindow {
                used_percent: Some(30.0),
                window_minutes: Some(300),
                resets_at: Some(18000),
            }),
            secondary: None,
            synced_at: "1970-01-01T00:30:00Z".to_string(),
            plan_type: Some("plus".to_string()),
        };
        persist_account_usage(&conn, "a", "fixture-token", &current).unwrap();
        let stale = AccountUsage {
            primary: Some(AccountUsageWindow {
                used_percent: Some(20.0),
                ..current.primary.clone().unwrap()
            }),
            synced_at: "1970-01-01T00:20:00Z".to_string(),
            ..current
        };
        persist_account_usage(&conn, "a", "fixture-token", &stale).unwrap();
        let used: f64 = conn.query_row("SELECT json_extract(usage_json, '$.primary.usedPercent') FROM accounts WHERE id = 'a'", [], |row| row.get(0)).unwrap();
        assert_eq!(used, 30.0);
    }
}
