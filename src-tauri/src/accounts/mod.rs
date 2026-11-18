pub(crate) mod api_keys;
pub(crate) mod credits;
pub(crate) mod messages;
pub(crate) mod periods;
pub(crate) mod quiet_hours;
pub(crate) mod scheduler;
pub(crate) mod scheduling;
pub(crate) mod usage;

use crate::accounts::credits::ResetCreditsInfo;
use crate::accounts::periods::ensure_account_period;
use crate::accounts::usage::{
    at_is_due, begin_account_refresh, parse_cached_usage, persist_rotated_access_token,
    sync_active_oauth_account, AccountUsage,
};
use crate::auth::{
    account_type, apply_auth_json, apply_auth_json_if_pat, build_auth_json, can_apply_auth_json,
    exchange_refresh_token, exchange_rt_for_at, extract_personal_access_token,
    resolve_auth_json_credential, resolve_token_metadata, update_oauth_auth_json, AuthJsonCredential,
    AccountType, RtTokenInfo,
};
use crate::codex::daemon::restart_after_account_switch;
use crate::sessions::sync::request_session_sync;
use crate::state::AppState;
use chrono::DateTime;
use chrono::Utc;
use rusqlite::params;
use rusqlite::OptionalExtension;
use serde::Deserialize;
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use tauri::Emitter;
use tauri::State;
use uuid::Uuid;

// 调度与账号编辑共用切换锁，凭证写入与 daemon 重启完成前不接受下一次切换。
static ACCOUNT_SWITCH_LOCK: tauri::async_runtime::Mutex<()> =
    tauri::async_runtime::Mutex::const_new(());

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AuthMethod {
    ApiKey,
    Pat,
    Oauth,
}

fn auth_method(content: &str) -> AuthMethod {
    if account_type(content) == AccountType::OpenaiApiKey {
        AuthMethod::ApiKey
    } else if extract_personal_access_token(content).is_some() {
        AuthMethod::Pat
    } else {
        AuthMethod::Oauth
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct Account {
    pub(crate) id: String,
    #[serde(default, rename = "accountType")]
    pub(crate) account_type: AccountType,
    #[serde(rename = "authMethod")]
    pub(crate) auth_method: AuthMethod,
    pub(crate) enabled: bool,
    pub(crate) name: String,
    #[serde(rename = "authJsonContent")]
    pub(crate) auth_json_content: String,
    pub(crate) notes: Option<String>,
    #[serde(rename = "createdAt")]
    pub(crate) created_at: String,
    #[serde(rename = "updatedAt")]
    pub(crate) updated_at: String,
    #[serde(rename = "planType")]
    pub(crate) plan_type: String,
    pub(crate) usage: Option<AccountUsage>,
    #[serde(rename = "canRefreshUsage")]
    pub(crate) can_refresh_usage: bool,
    #[serde(rename = "canActivate")]
    pub(crate) can_activate: bool,
    #[serde(rename = "nextRefreshAt")]
    pub(crate) next_refresh_at: Option<String>,
    #[serde(rename = "chatgptPlanType")]
    pub(crate) chatgpt_plan_type: Option<String>,
    #[serde(rename = "hasAccessToken")]
    pub(crate) has_access_token: bool,
    #[serde(rename = "resetCredits")]
    pub(crate) reset_credits: Option<ResetCreditsInfo>,
    #[serde(skip)]
    pub(crate) is_active: bool,
    #[serde(skip)]
    pub(crate) access_token: Option<String>,
    #[serde(skip)]
    pub(crate) chatgpt_account_id: Option<String>,
    #[serde(skip)]
    pub(crate) chatgpt_account_is_fedramp: bool,
    #[serde(skip)]
    pub(crate) refresh_token: Option<String>,
    #[serde(rename = "atExpiresAt")]
    pub(crate) at_expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct AccountStore {
    #[serde(rename = "activeAccountId")]
    pub(crate) active_account_id: Option<String>,
    pub(crate) accounts: Vec<Account>,
}

#[tauri::command]
pub(crate) async fn get_accounts(app: tauri::AppHandle) -> Result<AccountStore, String> {
    crate::db::with_db(app, read_accounts).await
}

pub(crate) fn read_accounts(db: &rusqlite::Connection) -> Result<AccountStore, String> {
    let mut stmt = db.prepare("SELECT id, name, auth_json_content, notes, created_at, updated_at, is_active, plan_type, usage_json, next_refresh_at, chatgpt_plan_type, access_token, chatgpt_account_id, chatgpt_account_is_fedramp, reset_credits_json, refresh_token, at_expires_at, is_disabled FROM accounts ORDER BY is_active DESC, created_at ASC").map_err(|e| e.to_string())?;
    let account_iter = stmt
        .query_map([], |row| {
            let auth_json_content: String = row.get(2)?;
            let access_token: Option<String> = row.get(11)?;
            let refresh_token: Option<String> = row.get(15)?;
            let account_type = account_type(&auth_json_content);
            let is_api_key = account_type == AccountType::OpenaiApiKey;
            Ok(Account {
                id: row.get(0)?,
                account_type,
                auth_method: auth_method(&auth_json_content),
                enabled: !row.get::<_, bool>(17)?,
                name: row.get(1)?,
                can_refresh_usage: !is_api_key && (extract_personal_access_token(&auth_json_content).is_some()
                    || access_token.is_some()),
                can_activate: can_apply_auth_json(&auth_json_content)
                    || refresh_token
                        .as_deref()
                        .is_some_and(|token| !token.trim().is_empty()),
                auth_json_content,
                notes: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                is_active: row.get::<_, i32>(6)? == 1,
                plan_type: row.get(7)?,
                usage: if is_api_key { None } else { parse_cached_usage(row.get(8)?) },
                next_refresh_at: if is_api_key { None } else { row.get(9)? },
                chatgpt_plan_type: row.get(10)?,
                has_access_token: access_token.is_some(),
                reset_credits: row
                    .get::<_, Option<String>>(14)?
                    .and_then(|json| serde_json::from_str(&json).ok()),
                access_token,
                chatgpt_account_id: row.get(12)?,
                chatgpt_account_is_fedramp: row.get::<_, i32>(13)? == 1,
                refresh_token,
                at_expires_at: row.get(16)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut accounts = Vec::new();
    let mut active_account_id = None;

    for account_result in account_iter {
        let account = account_result.map_err(|e| e.to_string())?;
        if account.is_active {
            active_account_id = Some(account.id.clone());
        }
        accounts.push(account);
    }

    Ok(AccountStore {
        active_account_id,
        accounts,
    })
}

pub(super) fn ensure_account_enabled(db: &rusqlite::Connection, id: &str) -> Result<(), String> {
    let disabled: bool = db.query_row(
        "SELECT is_disabled FROM accounts WHERE id = ?1", [id], |row| row.get(0),
    ).optional().map_err(|error| error.to_string())?.ok_or("账号不存在")?;
    if disabled {
        return Err("账号已禁用，请先启用。".to_string());
    }
    Ok(())
}

fn set_account_enabled_in_db(
    db: &rusqlite::Connection,
    id: &str,
    enabled: bool,
    refreshing: bool,
) -> Result<(), String> {
    let active: bool = db.query_row(
        "SELECT is_active FROM accounts WHERE id = ?1", [id], |row| row.get(0),
    ).optional().map_err(|error| error.to_string())?.ok_or("账号不存在")?;
    // 已开始的网络请求结束后才允许禁用，避免禁用成功后仍有请求在途。
    if !enabled && refreshing {
        return Err("该账号正在刷新，请稍候。".to_string());
    }
    // 与调度候选条件一致，否则禁用后调度找不到接替账号，已禁用账号会一直留在使用中。
    if !enabled && active && !read_accounts(db)?.accounts.iter().any(|account| {
        account.id != id && scheduling::eligible(account)
    }) {
        return Err("没有其他可用的订阅账号，无法禁用当前账号。".to_string());
    }
    db.execute(
        "UPDATE accounts SET is_disabled = ?1, updated_at = ?2 WHERE id = ?3",
        params![!enabled, Utc::now().to_rfc3339(), id],
    ).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn set_account_enabled(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    let _switch_guard = ACCOUNT_SWITCH_LOCK.try_lock()
        .map_err(|_| "正在切换账号并重启 Codex，请稍候。".to_string())?;
    {
        // 与 begin_account_refresh 的登记互斥；执行入口还会在登记后复查启用状态。
        let refreshing = state.refreshing.lock().map_err(|error| error.to_string())?;
        let db = state.db.lock().map_err(|error| error.to_string())?;
        set_account_enabled_in_db(&db, &id, enabled, refreshing.contains(&id))?;
    }
    drop(_switch_guard);
    let _ = app.emit("accounts-updated", ());
    scheduling::request_lifecycle_evaluation(app);
    crate::logging::info("accounts", if enabled { "账号已启用。" } else { "账号已禁用。" });
    Ok(())
}

fn normalized_notes(notes: Option<String>) -> Option<String> {
    notes.map(|notes| notes.trim().to_string()).filter(|notes| !notes.is_empty())
}

fn update_account_notes_in_db(
    db: &rusqlite::Connection,
    id: &str,
    notes: Option<String>,
) -> Result<(), String> {
    let changed = db.execute(
        "UPDATE accounts SET notes = ?1, updated_at = ?2 WHERE id = ?3",
        params![normalized_notes(notes), Utc::now().to_rfc3339(), id],
    ).map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("账号不存在".to_string());
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn update_account_notes(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    notes: Option<String>,
) -> Result<(), String> {
    {
        let db = state.db.lock().map_err(|error| error.to_string())?;
        update_account_notes_in_db(&db, &id, notes)?;
    }
    let _ = app.emit("accounts-updated", ());
    Ok(())
}

fn validate_oauth_reauth(
    db: &rusqlite::Connection,
    id: &str,
    info: &RtTokenInfo,
) -> Result<(bool, Option<String>), String> {
    let (name, content, account_id, active): (String, String, Option<String>, bool) = db.query_row(
        "SELECT name, auth_json_content, chatgpt_account_id, is_active FROM accounts WHERE id = ?1",
        [id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    ).optional().map_err(|error| error.to_string())?.ok_or("账号不存在")?;
    if auth_method(&content) != AuthMethod::Oauth {
        return Err("仅 OAuth / Refresh Token 账号支持重新登录。".to_string());
    }
    if !name.eq_ignore_ascii_case(&info.email) {
        return Err("登录的账号与当前账号不一致：邮箱不匹配。".to_string());
    }
    if account_id.as_ref().zip(info.chatgpt_account_id.as_ref())
        .is_some_and(|(stored, new)| stored != new)
    {
        return Err("登录的账号与当前账号不一致：ChatGPT 账号 ID 不匹配。".to_string());
    }
    Ok((active, account_id))
}

// 调用者持有事务，活跃账号还需在提交前同步 auth.json。
fn reauth_oauth_account_in_db(
    db: &rusqlite::Connection,
    id: &str,
    info: &RtTokenInfo,
    notes: Option<String>,
) -> Result<(String, bool), String> {
    let (active, account_id) = validate_oauth_reauth(db, id, info)?;
    if info.access_token.trim().is_empty() || info.refresh_token.trim().is_empty() {
        return Err("Token 信息不完整，请重新兑换".to_string());
    }
    let expiry = DateTime::from_timestamp(info.at_expires_at, 0)
        .ok_or("Access Token 过期时间无效")?.to_rfc3339();
    let mut info = info.clone();
    info.chatgpt_account_id = info.chatgpt_account_id.or(account_id);
    let content = update_oauth_auth_json("{}", &info);
    db.execute(
        "UPDATE accounts SET auth_json_content = ?1, access_token = ?2, refresh_token = ?3,
         at_expires_at = ?4, chatgpt_plan_type = COALESCE(?5, chatgpt_plan_type),
         chatgpt_account_id = COALESCE(?6, chatgpt_account_id), notes = ?7,
         updated_at = ?8, reset_credits_json = NULL WHERE id = ?9",
        params![content, info.access_token, info.refresh_token, expiry, info.chatgpt_plan_type,
            info.chatgpt_account_id, normalized_notes(notes), Utc::now().to_rfc3339(), id],
    ).map_err(|error| error.to_string())?;
    Ok((content, active))
}

#[tauri::command]
pub(crate) async fn reauth_oauth_account(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    email: String,
    chatgpt_plan_type: Option<String>,
    chatgpt_account_id: Option<String>,
    id_token: Option<String>,
    access_token: String,
    refresh_token: String,
    at_expires_at: i64,
    notes: Option<String>,
) -> Result<Account, String> {
    let info = RtTokenInfo { email, chatgpt_plan_type, chatgpt_account_id, id_token,
        access_token, refresh_token, at_expires_at };
    let _switch_guard = ACCOUNT_SWITCH_LOCK.try_lock()
        .map_err(|_| "正在切换账号并重启 Codex，请稍候。".to_string())?;
    {
        let db = state.db.lock().map_err(|error| error.to_string())?;
        // 身份不匹配时直接返回，不让刷新互斥的本地凭证回读改动数据库。
        validate_oauth_reauth(&db, &id, &info)?;
    }
    let _refresh_guard = begin_account_refresh(&state, &id, None)?;
    let (account, active) = {
        let mut db = state.db.lock().map_err(|error| error.to_string())?;
        let tx = db.transaction().map_err(|error| error.to_string())?;
        let (content, active) = reauth_oauth_account_in_db(&tx, &id, &info, notes)?;
        if active {
            apply_auth_json(&content)?;
        }
        tx.commit().map_err(|error| error.to_string())?;
        if active {
            crate::codex::events::pause_for_account_switch(&app);
        }
        let account = read_accounts(&db)?.accounts.into_iter()
            .find(|account| account.id == id).ok_or("账号保存失败")?;
        (account, active)
    };
    let _ = app.emit("accounts-updated", ());
    if active {
        request_session_sync();
        restart_after_account_switch(&app).await;
    }
    crate::logging::info("accounts", "账号重新登录成功，凭证已更新。");
    Ok(account)
}

/// 保存通过 rt 兑换的账号（at + 新 rt + at 过期时间）。
#[tauri::command]
pub(crate) async fn save_rt_account(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    email: String,
    chatgpt_plan_type: Option<String>,
    chatgpt_account_id: Option<String>,
    id_token: Option<String>,
    access_token: String,
    refresh_token: String,
    at_expires_at: i64,
    notes: Option<String>,
) -> Result<Account, String> {
    let account = insert_rt_account(
        &state,
        RtTokenInfo {
            email,
            chatgpt_plan_type,
            chatgpt_account_id,
            id_token,
            access_token,
            refresh_token,
            at_expires_at,
        },
        notes,
    )
    .await?;
    let _ = app.emit("accounts-updated", ());
    scheduling::request_lifecycle_evaluation(app);
    Ok(account)
}

/// 校验 PAT 并入库（手动添加与 auth.json 自动导入共用）。
/// 首个账号自动设为活跃账号并写入 ~/.codex/auth.json。
async fn insert_pat_account(
    state: &State<'_, AppState>,
    token: String,
    notes: Option<String>,
) -> Result<Account, String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("Token 不能为空".to_string());
    }
    let auth_json_content = build_auth_json(&token);

    let meta = tauri::async_runtime::spawn_blocking({
        let token = token.clone();
        move || resolve_token_metadata(&token)
    })
    .await
    .map_err(|e| format!("Token 校验任务失败：{e}"))??;

    let now = Utc::now().to_rfc3339();
    let can_refresh_usage = extract_personal_access_token(&auth_json_content).is_some();
    let account = Account {
        id: Uuid::new_v4().to_string(),
        account_type: AccountType::Chatgpt,
        auth_method: AuthMethod::Pat,
        enabled: true,
        name: meta.email,
        auth_json_content,
        notes,
        created_at: now.clone(),
        updated_at: now,
        // 限额类型（周限/月限）在首次额度刷新后自动推导，这里先给默认值。
        plan_type: "weekly".to_string(),
        usage: None,
        can_refresh_usage,
        can_activate: true,
        next_refresh_at: None,
        chatgpt_plan_type: meta.chatgpt_plan_type,
        has_access_token: false,
        reset_credits: None,
        is_active: false,
        access_token: None,
        chatgpt_account_id: meta.chatgpt_account_id,
        chatgpt_account_is_fedramp: meta.chatgpt_account_is_fedramp,
        refresh_token: None,
        at_expires_at: None,
    };

    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let count: i32 = db
        .query_row(
            "SELECT COUNT(*) FROM accounts WHERE is_active = 1",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    let mut account_to_return = account.clone();
    account_to_return.is_active = count == 0;

    let tx = db.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO accounts (id, name, auth_json_content, notes, created_at, updated_at, is_active, plan_type, chatgpt_plan_type, chatgpt_account_id, chatgpt_account_is_fedramp) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![account.id, account.name, account.auth_json_content, account.notes, account.created_at, account.updated_at, if count == 0 { 1 } else { 0 }, account.plan_type, account.chatgpt_plan_type, account.chatgpt_account_id, account.chatgpt_account_is_fedramp as i32],
    )
    .map_err(|e| e.to_string())?;
    if count == 0 {
        apply_auth_json(&account.auth_json_content)?;
        ensure_account_period(&tx, Some(&account.id), &Utc::now().to_rfc3339());
    }
    tx.commit().map_err(|e| e.to_string())?;

    Ok(account_to_return)
}

/// 入库 rt 兑换出的账号（手动添加与 auth.json 自动导入共用）。
/// 保存完整 OAuth 凭证，由智能调度写入本地认证并开启账号活跃时段。
async fn insert_rt_account(
    state: &State<'_, AppState>,
    info: RtTokenInfo,
    notes: Option<String>,
) -> Result<Account, String> {
    if info.access_token.trim().is_empty() || info.refresh_token.trim().is_empty() {
        return Err("Token 信息不完整，请重新兑换".to_string());
    }

    let auth_json_content = update_oauth_auth_json("{}", &info);
    let now = Utc::now().to_rfc3339();
    let at_expires = DateTime::from_timestamp(info.at_expires_at, 0)
        .map(|time| time.to_rfc3339())
        .unwrap_or_else(|| now.clone());

    let account = Account {
        id: Uuid::new_v4().to_string(),
        account_type: AccountType::Chatgpt,
        auth_method: AuthMethod::Oauth,
        enabled: true,
        name: info.email,
        auth_json_content,
        notes,
        created_at: now.clone(),
        updated_at: now,
        // 限额类型由额度接口自动推导。
        plan_type: "weekly".to_string(),
        usage: None,
        can_refresh_usage: true,
        can_activate: true,
        next_refresh_at: None,
        chatgpt_plan_type: info.chatgpt_plan_type,
        has_access_token: true,
        reset_credits: None,
        is_active: false,
        access_token: Some(info.access_token),
        chatgpt_account_id: info.chatgpt_account_id,
        chatgpt_account_is_fedramp: false,
        refresh_token: Some(info.refresh_token),
        at_expires_at: Some(at_expires),
    };

    let mut db = state.db.lock().map_err(|e| e.to_string())?;

    let tx = db.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO accounts (id, name, auth_json_content, notes, created_at, updated_at, is_active, plan_type, chatgpt_plan_type, chatgpt_account_id, chatgpt_account_is_fedramp, access_token, refresh_token, at_expires_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
        params![account.id, account.name, account.auth_json_content, account.notes, account.created_at, account.updated_at, 0, account.plan_type, account.chatgpt_plan_type, account.chatgpt_account_id, account.chatgpt_account_is_fedramp as i32, account.access_token, account.refresh_token, account.at_expires_at],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;

    Ok(account)
}

#[tauri::command]
pub(crate) async fn add_account(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    token: String,
    notes: Option<String>,
) -> Result<Account, String> {
    let account = insert_pat_account(&state, token, notes).await?;
    let _ = app.emit("accounts-updated", ());
    scheduling::request_lifecycle_evaluation(app);
    Ok(account)
}

#[tauri::command]
pub(crate) async fn update_account(
    state: State<'_, AppState>,
    id: String,
    token: String,
    notes: Option<String>,
) -> Result<Account, String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("Token 不能为空".to_string());
    }
    let auth_json_content = build_auth_json(&token);
    let now = Utc::now().to_rfc3339();

    // 读取现有账号信息，判断 PAT 是否变化。
    let (
        existing_auth_json_content,
        existing_name,
        existing_plan_type,
        existing_usage_json,
        _existing_usage_updated_at,
        existing_next_refresh_at,
        existing_chatgpt_plan_type,
        existing_access_token,
        existing_chatgpt_account_id,
        existing_is_fedramp,
        existing_reset_credits_json,
        existing_refresh_token,
        existing_at_expires_at,
        is_active,
        existing_is_disabled,
    ) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.query_row(
            "SELECT auth_json_content, name, plan_type, usage_json, usage_updated_at, next_refresh_at, chatgpt_plan_type, access_token, chatgpt_account_id, chatgpt_account_is_fedramp, reset_credits_json, refresh_token, at_expires_at, is_active, is_disabled FROM accounts WHERE id = ?1",
            params![id],
            |row| Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, i32>(9)? == 1,
                row.get::<_, Option<String>>(10)?,
                row.get::<_, Option<String>>(11)?,
                row.get::<_, Option<String>>(12)?,
                row.get::<_, i32>(13)? == 1,
                row.get::<_, bool>(14)?,
            )),
        )
        .map_err(|_| "Account not found".to_string())?
    };

    if account_type(&existing_auth_json_content) == AccountType::OpenaiApiKey {
        return Err("请通过 API Key 表单编辑该账号".to_string());
    }
    let token_changed = extract_personal_access_token(&existing_auth_json_content).as_deref()
        != Some(token.as_str());

    if !token_changed {
        // PAT 未变化：仅更新备注，保留已有信息与额度，不调用 whoami。
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let rows = db
            .execute(
                "UPDATE accounts SET notes = ?1, updated_at = ?2 WHERE id = ?3",
                params![notes, now, id],
            )
            .map_err(|e| e.to_string())?;
        if rows == 0 {
            return Err("Account not found".to_string());
        }
        return Ok(Account {
            id,
            account_type: AccountType::Chatgpt,
            auth_method: AuthMethod::Pat,
            enabled: !existing_is_disabled,
            name: existing_name,
            auth_json_content: existing_auth_json_content,
            notes,
            created_at: "".to_string(), // Frontend doesn't need to update created_at usually
            updated_at: now,
            plan_type: existing_plan_type,
            usage: parse_cached_usage(existing_usage_json),
            can_refresh_usage: true,
            can_activate: true,
            next_refresh_at: existing_next_refresh_at,
            chatgpt_plan_type: existing_chatgpt_plan_type,
            has_access_token: existing_access_token.is_some(),
            reset_credits: existing_reset_credits_json
                .and_then(|json| serde_json::from_str(&json).ok()),
            is_active,
            access_token: existing_access_token,
            chatgpt_account_id: existing_chatgpt_account_id,
            chatgpt_account_is_fedramp: existing_is_fedramp,
            refresh_token: existing_refresh_token,
            at_expires_at: existing_at_expires_at,
        });
    }

    // PAT 变化：重新走 whoami，清除旧身份的 OAuth 凭证、重置卡和额度缓存。
    let meta = tauri::async_runtime::spawn_blocking({
        let token = token.clone();
        move || resolve_token_metadata(&token)
    })
    .await
    .map_err(|e| format!("Token 校验任务失败：{e}"))??;

    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let tx = db.transaction().map_err(|e| e.to_string())?;

    let rows_affected = tx
        .execute(
            "UPDATE accounts SET name = ?1, auth_json_content = ?2, notes = ?3, updated_at = ?4, plan_type = 'weekly', usage_json = NULL, usage_updated_at = NULL, next_refresh_at = NULL, access_token = NULL, refresh_token = NULL, at_expires_at = NULL, reset_credits_json = NULL, chatgpt_plan_type = ?5, chatgpt_account_id = ?6, chatgpt_account_is_fedramp = ?7 WHERE id = ?8",
            params![meta.email, auth_json_content, notes, now, meta.chatgpt_plan_type, meta.chatgpt_account_id, meta.chatgpt_account_is_fedramp as i32, id],
        )
        .map_err(|e| e.to_string())?;

    if rows_affected == 0 {
        return Err("Account not found".to_string());
    }
    tx.commit().map_err(|e| e.to_string())?;

    if is_active {
        apply_auth_json_if_pat(&auth_json_content);
    }

    Ok(Account {
        id,
        account_type: AccountType::Chatgpt,
        auth_method: AuthMethod::Pat,
        enabled: !existing_is_disabled,
        name: meta.email,
        auth_json_content,
        notes,
        created_at: "".to_string(), // Frontend doesn't need to update created_at usually
        updated_at: now,
        plan_type: "weekly".to_string(),
        usage: None,
        can_refresh_usage: true,
        can_activate: true,
        next_refresh_at: None,
        chatgpt_plan_type: meta.chatgpt_plan_type,
        has_access_token: false,
        reset_credits: None,
        is_active,
        access_token: None,
        chatgpt_account_id: meta.chatgpt_account_id,
        chatgpt_account_is_fedramp: meta.chatgpt_account_is_fedramp,
        refresh_token: None,
        at_expires_at: None,
    })
}

/// 保存 team 账号的 Access Token（at），用于获取重置卡等 PAT 无法访问的接口。
#[tauri::command]
pub(crate) fn set_account_access_token(
    state: State<'_, AppState>,
    id: String,
    access_token: String,
) -> Result<(), String> {
    let access_token = access_token.trim().to_string();
    if access_token.is_empty() {
        return Err("Access Token 不能为空".to_string());
    }
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let rows = db
        .execute(
            "UPDATE accounts SET access_token = ?1, reset_credits_json = NULL WHERE id = ?2",
            params![access_token, id],
        )
        .map_err(|e| e.to_string())?;
    if rows == 0 {
        return Err("Account not found".to_string());
    }
    Ok(())
}

fn deletion_successor(db: &rusqlite::Connection, now: i64) -> Result<Option<Account>, String> {
    // 删除事务内不能联网续期；只在凭证已完整的订阅账号中应用相同的调度规则。
    let accounts: Vec<_> = read_accounts(db)?.accounts.into_iter()
        .filter(|account| scheduling::eligible(account) && can_apply_auth_json(&account.auth_json_content))
        .collect();
    let plan = scheduling::evaluate_schedule(&accounts, None, now);
    Ok(accounts.into_iter().find(|account| plan.decision.target_id() == Some(account.id.as_str())))
}

#[tauri::command]
pub(crate) async fn delete_account(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let _switch_guard = ACCOUNT_SWITCH_LOCK
        .try_lock()
        .map_err(|_| "正在切换账号并重启 Codex，请稍候。".to_string())?;
    let switched = {
        let mut db = state.db.lock().map_err(|e| e.to_string())?;
        sync_active_oauth_account(&db)?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        let is_active: bool = tx
            .query_row(
                "SELECT is_active FROM accounts WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .unwrap_or(false);
        tx.execute("DELETE FROM accounts WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;

        let now = Utc::now().to_rfc3339();
        tx.execute(
            "UPDATE account_active_periods SET ended_at = ?1 WHERE account_id = ?2 AND ended_at IS NULL",
            params![now, id],
        )
        .map_err(|e| e.to_string())?;
        let mut switched = false;
        if is_active {
            let next = deletion_successor(&tx, Utc::now().timestamp())?;
            tx.execute("UPDATE accounts SET is_active = 0", [])
                .map_err(|e| e.to_string())?;
            tx.execute(
                "UPDATE account_active_periods SET ended_at = ?1 WHERE ended_at IS NULL",
                params![now],
            )
            .map_err(|e| e.to_string())?;
            if let Some(next) = next {
                apply_auth_json(&next.auth_json_content)?;
                tx.execute(
                    "UPDATE accounts SET is_active = 1 WHERE id = ?1",
                    params![next.id],
                )
                .map_err(|e| e.to_string())?;
                tx.execute(
                    "INSERT INTO account_active_periods (account_id, started_at) VALUES (?1, ?2)",
                    params![next.id, now],
                )
                .map_err(|e| e.to_string())?;
                switched = true;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        if is_active { crate::codex::events::pause_for_account_switch(&app); }
        switched
    };
    let _ = app.emit("accounts-updated", ());
    request_session_sync();
    if switched {
        crate::logging::info("accounts", "已删除当前账号，并切换至可用账号。");
        restart_after_account_switch(&app).await;
    } else {
        crate::codex::events::resume_after_account_switch(&app);
        crate::logging::info("accounts", "账号已删除。");
    }
    drop(_switch_guard);
    scheduling::request_lifecycle_evaluation(app);
    Ok(())
}

/// 只供智能调度调用，调用者持有 ACCOUNT_SWITCH_LOCK。
async fn switch_active_account_locked(
    app: &tauri::AppHandle,
    state: &AppState,
    id: &str,
    excluded: &HashSet<String>,
    trigger: &scheduling::SwitchTrigger,
) -> Result<bool, String> {
    {
        let db = state.db.lock().map_err(|error| error.to_string())?;
        let plan = scheduling::evaluate_candidates_for_trigger(&read_accounts(&db)?, excluded, Utc::now().timestamp(), trigger);
        if plan.decision.target_id() != Some(id) {
            return Ok(false);
        }
    }
    // 与额度查询、后台续期共用互斥；回读本机认证后再读取凭证，避免重复兑换同一个 Refresh Token。
    let _guard = begin_account_refresh(state, id, None)?;
    let (content, refresh_token, at_expires_at, is_active, disabled) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.query_row(
            "SELECT auth_json_content, refresh_token, at_expires_at, is_active, is_disabled FROM accounts WHERE id = ?1",
            params![id],
            |row| Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, bool>(3)?,
                row.get::<_, bool>(4)?,
            )),
        )
        .map_err(|_| "Account not found".to_string())?
    };
    if disabled {
        return Err("账号已禁用，请先启用后再切换。".to_string());
    }
    if is_active {
        return Ok(false);
    }

    // 旧版只保存了 at/rt；首次启用时兑换并补齐 id_token，过期凭证也先续期。
    if account_type(&content) == AccountType::Chatgpt
        && extract_personal_access_token(&content).is_none()
        && (!can_apply_auth_json(&content) || at_expires_at.is_none() || at_is_due(&at_expires_at))
    {
        let rt = refresh_token
            .filter(|token| !token.trim().is_empty())
            .ok_or_else(|| "账号登录信息不完整，请重新进行 OAuth 登录。".to_string())?;
        let expected_rt = rt.clone();
        let info = tauri::async_runtime::spawn_blocking(move || exchange_rt_for_at(&rt))
            .await
            .map_err(|e| format!("账号认证续期任务失败：{e}"))??;
        let db = state.db.lock().map_err(|e| e.to_string())?;
        persist_rotated_access_token(&db, &id, &expected_rt, &info, true)?;
    }

    {
        let mut db = state.db.lock().map_err(|e| e.to_string())?;
        sync_active_oauth_account(&db)?;
        // 认证续期期间额度可能已改变；在同一个数据库临界区中重新决策后才提交。
        let plan = scheduling::evaluate_candidates_for_trigger(&read_accounts(&db)?, excluded, Utc::now().timestamp(), trigger);
        if plan.decision.target_id() != Some(id) {
            return Ok(false);
        }
        let tx = db.transaction().map_err(|e| e.to_string())?;

        // 目标账号已是活跃账号：直接返回，避免重复开段或重启 daemon。
        let already_active: bool = tx
            .query_row(
                "SELECT COUNT(*) FROM accounts WHERE id = ?1 AND is_active = 1",
                params![id],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0)
            > 0;
        if already_active {
            return Ok(false);
        }

        let content: String = tx
            .query_row(
                "SELECT auth_json_content FROM accounts WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .map_err(|_| "Account not found".to_string())?;

        if !can_apply_auth_json(&content) {
            return Err("账号登录信息不完整，请重新进行 OAuth 登录。".to_string());
        }

        // 记录账号活跃时段：供会话返回的剩余额度按账号归属。
        let now = Utc::now().to_rfc3339();
        tx.execute(
            "UPDATE account_active_periods SET ended_at = ?1 WHERE ended_at IS NULL",
            params![now],
        )
        .map_err(|e| e.to_string())?;

        tx.execute(
            "INSERT INTO account_active_periods (account_id, started_at) VALUES (?1, ?2)",
            params![id, now],
        )
        .map_err(|e| e.to_string())?;

        tx.execute("UPDATE accounts SET is_active = 0", [])
            .map_err(|e| e.to_string())?;
        tx.execute(
            "UPDATE accounts SET is_active = 1 WHERE id = ?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;

        apply_auth_json(&content)?;
        tx.commit().map_err(|e| e.to_string())?;
        crate::codex::events::pause_for_account_switch(app);
    }
    let _ = app.emit("accounts-updated", ());
    request_session_sync();
    crate::logging::info("accounts", "账号已切换，准备重启 Codex app-server。");
    restart_after_account_switch(app).await;
    Ok(true)
}

/// 账号库为空时，从 ~/.codex/auth.json 导入 PAT、rt 或官方 API Key。
/// 无 auth.json、格式不支持或已有账号时不处理；导入成功返回账号。
#[tauri::command]
pub(crate) async fn import_account_from_auth_json(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<Account>, String> {
    // 已有账号则跳过（幂等，避免重复导入）。
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let count: i32 = db
            .query_row("SELECT COUNT(*) FROM accounts", [], |row| row.get(0))
            .unwrap_or(0);
        if count > 0 {
            return Ok(None);
        }
    }

    let auth_path = crate::codex::paths::codex_home()?.join("auth.json");
    let Ok(content) = fs::read_to_string(&auth_path) else {
        return Ok(None); // 无 auth.json：不处理
    };

    let Some(credential) = resolve_auth_json_credential(&content) else {
        return Ok(None); // 格式不支持：不处理
    };

    let account = match credential {
        AuthJsonCredential::OpenaiApiKey => {
            api_keys::save_api_key_account(app.clone(), state, None, String::new(), content, None).await?
        }
        AuthJsonCredential::Pat(token) => insert_pat_account(&state, token, None).await?,
        AuthJsonCredential::RefreshToken(rt) => {
            // rt 兑换出 at 与账号信息后入库（rt 一次性使用）。
            let info = exchange_refresh_token(rt).await?;
            insert_rt_account(&state, info, None).await?
        }
    };
    let _ = app.emit("accounts-updated", ());
    scheduling::request_lifecycle_evaluation(app);
    crate::logging::info("auth-import", "已自动导入本机账号。");
    Ok(Some(account))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::{types::Value, Connection};

    fn database() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        crate::db::init_db(&db).unwrap();
        db
    }

    fn insert(db: &Connection, id: &str, content: &str, active: bool) {
        db.execute(
            "INSERT INTO accounts (id, name, auth_json_content, created_at, updated_at, is_active,
             chatgpt_account_id) VALUES (?1, 'test@example.invalid', ?2, '2026-01-01', '2026-01-01', ?3, 'workspace')",
            params![id, content, active],
        ).unwrap();
    }

    fn snapshot(db: &Connection, columns: &str) -> Vec<Value> {
        let mut stmt = db.prepare(&format!("SELECT {columns} FROM accounts WHERE id = 'oauth'")).unwrap();
        let count = stmt.column_count();
        stmt.query_row([], |row| (0..count).map(|index| row.get(index)).collect()).unwrap()
    }

    fn login_info() -> RtTokenInfo {
        RtTokenInfo {
            email: "TEST@example.invalid".to_string(),
            chatgpt_plan_type: Some("plus".to_string()),
            chatgpt_account_id: Some("workspace".to_string()),
            id_token: Some("test-id-token".to_string()),
            access_token: "test-new-access".to_string(),
            refresh_token: "test-new-refresh".to_string(),
            at_expires_at: 1_900_000_000,
        }
    }

    #[test]
    fn read_accounts_derives_auth_methods_and_serializes_public_metadata() {
        let db = database();
        insert(&db, "pat", &build_auth_json("test-pat"), false);
        insert(&db, "api", &crate::auth::build_api_key_auth_json("sk-test"), true);
        insert(&db, "oauth", &update_oauth_auth_json("{}", &login_info()), false);
        db.execute("UPDATE accounts SET is_disabled = 1, at_expires_at = '2030-03-17T17:46:40Z' WHERE id = 'oauth'", []).unwrap();
        let store = read_accounts(&db).unwrap();
        assert_eq!(store.active_account_id.as_deref(), Some("api"));
        assert_eq!(store.accounts[0].auth_method, AuthMethod::ApiKey);
        assert!(store.accounts.iter().all(|account| account.enabled == (account.id != "oauth")));
        let pat = store.accounts.iter().find(|account| account.id == "pat").unwrap();
        assert_eq!(pat.auth_method, AuthMethod::Pat);
        let oauth = store.accounts.iter().find(|account| account.id == "oauth").unwrap();
        let json = serde_json::to_value(oauth).unwrap();
        assert_eq!(json["authMethod"], "oauth");
        assert_eq!(json["enabled"], false);
        assert_eq!(json["atExpiresAt"], "2030-03-17T17:46:40Z");
        assert!(json.get("access_token").is_none());
        assert!(json.get("refresh_token").is_none());
    }

    #[test]
    fn enable_guard_requires_another_subscription_for_active_and_rejects_busy_and_unknown() {
        let db = database();
        insert(&db, "oauth", "{}", true);
        let before = snapshot(&db, "*");
        assert_eq!(set_account_enabled_in_db(&db, "oauth", false, false).unwrap_err(),
            "没有其他可用的订阅账号，无法禁用当前账号。");
        assert_eq!(snapshot(&db, "*"), before);
        insert(&db, "api", &crate::auth::build_api_key_auth_json("sk-test"), false);
        insert(&db, "incomplete", "{}", false);
        insert(&db, "disabled", &build_auth_json("test-pat"), false);
        db.execute("UPDATE accounts SET is_disabled = 1 WHERE id = 'disabled'", []).unwrap();
        assert_eq!(set_account_enabled_in_db(&db, "oauth", false, false).unwrap_err(),
            "没有其他可用的订阅账号，无法禁用当前账号。");
        assert_eq!(snapshot(&db, "*"), before);
        assert_eq!(set_account_enabled_in_db(&db, "missing", false, false).unwrap_err(), "账号不存在");
        insert(&db, "replacement", &build_auth_json("test-pat"), false);
        assert_eq!(set_account_enabled_in_db(&db, "oauth", false, true).unwrap_err(), "该账号正在刷新，请稍候。");
        assert_eq!(snapshot(&db, "*"), before);
        set_account_enabled_in_db(&db, "oauth", false, false).unwrap();
        // 只修改启用状态，活跃账号由随后的调度评估切走。
        assert!(read_accounts(&db).unwrap().accounts.iter().find(|account| account.id == "oauth").unwrap().is_active);
        let disabled = snapshot(&db, "*");
        assert_eq!(ensure_account_enabled(&db, "oauth").unwrap_err(), "账号已禁用，请先启用。");
        assert_eq!(snapshot(&db, "*"), disabled);
        set_account_enabled_in_db(&db, "oauth", true, false).unwrap();
        assert!(ensure_account_enabled(&db, "oauth").is_ok());
    }

    #[test]
    fn deletion_successor_uses_schedule_order_and_recovery_without_api_or_incomplete_auth() {
        let db = database();
        let now = 1_900_000_000;
        for id in ["later", "earlier", "disabled"] {
            insert(&db, id, &build_auth_json("test-pat"), false);
        }
        insert(&db, "api", &crate::auth::build_api_key_auth_json("sk-test"), false);
        insert(&db, "incomplete", "{}", false);
        db.execute("UPDATE accounts SET is_disabled = 1 WHERE id = 'disabled'", []).unwrap();
        // rt 可以续期，但事务中不能联网，因此不能选择缺少完整 auth.json 的账号。
        db.execute("UPDATE accounts SET refresh_token = 'test-rt', access_token = 'test-at' WHERE id = 'incomplete'", []).unwrap();
        for (id, used, reset) in [("later", 0.0, now + 900), ("earlier", 0.0, now + 100),
            ("disabled", 0.0, now + 1), ("incomplete", 0.0, now + 1)] {
            db.execute("UPDATE accounts SET usage_json = ?1 WHERE id = ?2",
                params![serde_json::to_string(&crate::test_support::usage(used, Some(reset))).unwrap(), id]).unwrap();
        }
        assert_eq!(deletion_successor(&db, now).unwrap().unwrap().id, "earlier");
        for (id, reset) in [("earlier", now + 600), ("later", now + 300)] {
            db.execute("UPDATE accounts SET usage_json = ?1 WHERE id = ?2",
                params![serde_json::to_string(&crate::test_support::usage(100.0, Some(reset))).unwrap(), id]).unwrap();
        }
        assert_eq!(deletion_successor(&db, now).unwrap().unwrap().id, "later");
        db.execute("DELETE FROM accounts WHERE id IN ('earlier', 'later')", []).unwrap();
        assert!(deletion_successor(&db, now).unwrap().is_none());
    }

    #[test]
    fn oauth_reauth_rejects_identity_mismatches_without_changing_row() {
        let db = database();
        insert(&db, "oauth", "{}", false);
        let before = snapshot(&db, "*");
        let mut info = login_info();
        info.email = "other@example.invalid".to_string();
        assert!(reauth_oauth_account_in_db(&db, "oauth", &info, None).unwrap_err().starts_with("登录的账号与当前账号不一致："));
        assert_eq!(snapshot(&db, "*"), before);
        info.email = "test@example.invalid".to_string();
        info.chatgpt_account_id = Some("other-workspace".to_string());
        assert!(reauth_oauth_account_in_db(&db, "oauth", &info, None).is_err());
        assert_eq!(snapshot(&db, "*"), before);
    }

    #[test]
    fn oauth_reauth_rejects_pat_and_api_key_accounts() {
        let db = database();
        for content in [build_auth_json("test-pat"), crate::auth::build_api_key_auth_json("sk-test")] {
            db.execute("DELETE FROM accounts", []).unwrap();
            insert(&db, "oauth", &content, false);
            let before = snapshot(&db, "*");
            assert_eq!(reauth_oauth_account_in_db(&db, "oauth", &login_info(), None).unwrap_err(),
                "仅 OAuth / Refresh Token 账号支持重新登录。");
            assert_eq!(snapshot(&db, "*"), before);
        }
    }

    #[test]
    fn oauth_reauth_preserves_usage_settings_and_disabled_state() {
        let mut db = database();
        insert(&db, "oauth", "{}", false);
        let usage = serde_json::to_string(&crate::test_support::usage(40.0, Some(1_900_000_000))).unwrap();
        db.execute(
            "UPDATE accounts SET is_disabled = 1, usage_json = ?1, usage_updated_at = '2026-01-02',
             next_refresh_at = '2026-01-03', auto_switch_threshold = 25, auto_activate_window = 1,
             chatgpt_plan_type = 'team', reset_credits_json = '{}' WHERE id = 'oauth'", [usage],
        ).unwrap();
        let columns = "id, name, created_at, is_active, is_disabled, usage_json, usage_updated_at, next_refresh_at, auto_switch_threshold, auto_activate_window, plan_type";
        let before = snapshot(&db, columns);
        let mut info = login_info();
        info.chatgpt_plan_type = None;
        info.chatgpt_account_id = None;
        let tx = db.transaction().unwrap();
        let (content, active) = reauth_oauth_account_in_db(&tx, "oauth", &info, Some("  新备注  ".to_string())).unwrap();
        assert!(!active);
        tx.commit().unwrap();
        assert_eq!(snapshot(&db, columns), before);
        let account = read_accounts(&db).unwrap().accounts.remove(0);
        assert_eq!(account.id, "oauth");
        assert_eq!(account.notes.as_deref(), Some("新备注"));
        assert_eq!(account.chatgpt_plan_type.as_deref(), Some("team"));
        assert_eq!(account.chatgpt_account_id.as_deref(), Some("workspace"));
        assert_eq!(account.access_token.as_deref(), Some("test-new-access"));
        assert_eq!(account.refresh_token.as_deref(), Some("test-new-refresh"));
        assert!(account.reset_credits.is_none());
        assert!(can_apply_auth_json(&content));
        assert_eq!(serde_json::from_str::<serde_json::Value>(&content).unwrap()["tokens"]["account_id"], "workspace");
    }

    #[test]
    fn notes_update_preserves_credentials_and_clears_empty_text() {
        let db = database();
        insert(&db, "oauth", &update_oauth_auth_json("{}", &login_info()), false);
        let columns = "id, name, auth_json_content, created_at, is_active, is_disabled, usage_json, next_refresh_at, auto_switch_threshold";
        let before = snapshot(&db, columns);
        update_account_notes_in_db(&db, "oauth", Some("  备注  ".to_string())).unwrap();
        assert_eq!(read_accounts(&db).unwrap().accounts[0].notes.as_deref(), Some("备注"));
        assert_eq!(snapshot(&db, columns), before);
        update_account_notes_in_db(&db, "oauth", Some(" \n ".to_string())).unwrap();
        assert!(read_accounts(&db).unwrap().accounts[0].notes.is_none());
        assert_eq!(snapshot(&db, columns), before);
        assert_eq!(update_account_notes_in_db(&db, "missing", None).unwrap_err(), "账号不存在");
    }
}
