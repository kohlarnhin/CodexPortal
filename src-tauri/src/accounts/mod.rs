pub(crate) mod credits;
pub(crate) mod messages;
pub(crate) mod periods;
pub(crate) mod scheduler;
pub(crate) mod usage;

use crate::accounts::credits::ResetCreditsInfo;
use crate::accounts::periods::ensure_account_period;
use crate::accounts::usage::{parse_cached_usage, AccountUsage};
use crate::auth::{
    apply_auth_json, apply_auth_json_if_pat, build_auth_json, exchange_refresh_token,
    extract_personal_access_token, resolve_auth_json_credential, resolve_token_metadata,
    AuthJsonCredential, RtTokenInfo,
};
use crate::sessions::sync::request_session_sync;
use crate::state::AppState;
use chrono::DateTime;
use chrono::Utc;
use rusqlite::params;
use rusqlite::OptionalExtension;
use serde::Deserialize;
use serde::Serialize;
use std::fs;
use tauri::Emitter;
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct Account {
    pub(crate) id: String,
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
    #[serde(skip)]
    pub(crate) at_expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct AccountStore {
    #[serde(rename = "activeAccountId")]
    pub(crate) active_account_id: Option<String>,
    pub(crate) accounts: Vec<Account>,
}

#[tauri::command]
pub(crate) fn get_accounts(state: State<'_, AppState>) -> Result<AccountStore, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    let mut stmt = db.prepare("SELECT id, name, auth_json_content, notes, created_at, updated_at, is_active, plan_type, usage_json, next_refresh_at, chatgpt_plan_type, access_token, chatgpt_account_id, chatgpt_account_is_fedramp, reset_credits_json, refresh_token, at_expires_at FROM accounts ORDER BY is_active DESC, created_at ASC").map_err(|e| e.to_string())?;
    let account_iter = stmt
        .query_map([], |row| {
            let auth_json_content: String = row.get(2)?;
            let access_token: Option<String> = row.get(11)?;
            Ok(Account {
                id: row.get(0)?,
                name: row.get(1)?,
                can_refresh_usage: extract_personal_access_token(&auth_json_content).is_some()
                    || access_token.is_some(),
                auth_json_content,
                notes: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                is_active: row.get::<_, i32>(6)? == 1,
                plan_type: row.get(7)?,
                usage: parse_cached_usage(row.get(8)?),
                next_refresh_at: row.get(9)?,
                chatgpt_plan_type: row.get(10)?,
                has_access_token: access_token.is_some(),
                reset_credits: row
                    .get::<_, Option<String>>(14)?
                    .and_then(|json| serde_json::from_str(&json).ok()),
                access_token,
                chatgpt_account_id: row.get(12)?,
                chatgpt_account_is_fedramp: row.get::<_, i32>(13)? == 1,
                refresh_token: row.get(15)?,
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

/// 保存通过 rt 兑换的账号（at + 新 rt + at 过期时间）。
#[tauri::command]
pub(crate) async fn save_rt_account(
    state: State<'_, AppState>,
    email: String,
    chatgpt_plan_type: Option<String>,
    chatgpt_account_id: Option<String>,
    access_token: String,
    refresh_token: String,
    at_expires_at: i64,
    notes: Option<String>,
) -> Result<Account, String> {
    insert_rt_account(
        &state,
        RtTokenInfo {
            email,
            chatgpt_plan_type,
            chatgpt_account_id,
            access_token,
            refresh_token,
            at_expires_at,
        },
        notes,
    )
    .await
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
        name: meta.email,
        auth_json_content,
        notes,
        created_at: now.clone(),
        updated_at: now,
        // 限额类型（周限/月限）在首次额度刷新后自动推导，这里先给默认值。
        plan_type: "weekly".to_string(),
        usage: None,
        can_refresh_usage,
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
/// rt 账号用于额度管理，不写入 ~/.codex/auth.json，也不开启本地账号活跃时段。
async fn insert_rt_account(
    state: &State<'_, AppState>,
    info: RtTokenInfo,
    notes: Option<String>,
) -> Result<Account, String> {
    if info.access_token.trim().is_empty() || info.refresh_token.trim().is_empty() {
        return Err("Token 信息不完整，请重新兑换".to_string());
    }

    let auth_json_content = serde_json::json!({ "personal_access_token": null }).to_string();
    let now = Utc::now().to_rfc3339();
    let at_expires = DateTime::from_timestamp(info.at_expires_at, 0)
        .map(|time| time.to_rfc3339())
        .unwrap_or_else(|| now.clone());

    let account = Account {
        id: Uuid::new_v4().to_string(),
        name: info.email,
        auth_json_content,
        notes,
        created_at: now.clone(),
        updated_at: now,
        // 限额类型由额度接口自动推导。
        plan_type: "weekly".to_string(),
        usage: None,
        can_refresh_usage: true,
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

    // rt 账号无法生成 codex 可用的 auth.json，不写入 ~/.codex/auth.json。
    Ok(account)
}

#[tauri::command]
pub(crate) async fn add_account(
    state: State<'_, AppState>,
    token: String,
    notes: Option<String>,
) -> Result<Account, String> {
    insert_pat_account(&state, token, notes).await
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
    ) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.query_row(
            "SELECT auth_json_content, name, plan_type, usage_json, usage_updated_at, next_refresh_at, chatgpt_plan_type, access_token, chatgpt_account_id, chatgpt_account_is_fedramp, reset_credits_json, refresh_token, at_expires_at, is_active FROM accounts WHERE id = ?1",
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
            )),
        )
        .map_err(|_| "Account not found".to_string())?
    };

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
            name: existing_name,
            auth_json_content: existing_auth_json_content,
            notes,
            created_at: "".to_string(), // Frontend doesn't need to update created_at usually
            updated_at: now,
            plan_type: existing_plan_type,
            usage: parse_cached_usage(existing_usage_json),
            can_refresh_usage: true,
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

    // PAT 变化：重新走 whoami，清空额度缓存待刷新。
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
            "UPDATE accounts SET name = ?1, auth_json_content = ?2, notes = ?3, updated_at = ?4, plan_type = 'weekly', usage_json = NULL, usage_updated_at = NULL, next_refresh_at = NULL, chatgpt_plan_type = ?5, chatgpt_account_id = ?6, chatgpt_account_is_fedramp = ?7 WHERE id = ?8",
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
        name: meta.email,
        auth_json_content,
        notes,
        created_at: "".to_string(), // Frontend doesn't need to update created_at usually
        updated_at: now,
        plan_type: "weekly".to_string(),
        usage: None,
        can_refresh_usage: true,
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

#[tauri::command]
pub(crate) fn delete_account(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
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
    ).map_err(|e| e.to_string())?;
    if is_active {
        let candidates = {
            let mut stmt = tx
                .prepare("SELECT id, auth_json_content FROM accounts ORDER BY created_at, id")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        // 只有成功写入本地认证的账号才能接续会话额度归属；RT 账号仍可独立管理额度。
        let next = candidates
            .into_iter()
            .find(|(_, content)| extract_personal_access_token(content).is_some());
        tx.execute("UPDATE accounts SET is_active = 0", [])
            .map_err(|e| e.to_string())?;
        tx.execute(
            "UPDATE account_active_periods SET ended_at = ?1 WHERE ended_at IS NULL",
            params![now],
        )
        .map_err(|e| e.to_string())?;
        if let Some((next_id, content)) = next {
            apply_auth_json(&content)?;
            tx.execute(
                "UPDATE accounts SET is_active = 1 WHERE id = ?1",
                params![next_id],
            )
            .map_err(|e| e.to_string())?;
            tx.execute(
                "INSERT INTO account_active_periods (account_id, started_at) VALUES (?1, ?2)",
                params![next_id, now],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    drop(db);
    let _ = app.emit("accounts-updated", ());
    request_session_sync();
    Ok(())
}

#[tauri::command]
pub(crate) fn set_active_account(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let tx = db.transaction().map_err(|e| e.to_string())?;

    // 目标账号已是活跃账号：直接返回，避免重复开段产生重叠时段。
    let already_active: bool = tx
        .query_row(
            "SELECT COUNT(*) FROM accounts WHERE id = ?1 AND is_active = 1",
            params![id],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
        > 0;
    if already_active {
        return Ok(());
    }

    let content: String = tx
        .query_row(
            "SELECT auth_json_content FROM accounts WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|_| "Account not found".to_string())?;

    if extract_personal_access_token(&content).is_none() {
        return Err(
            "该账号没有可用于本地切换的 PAT，请先补充 PAT；仍可刷新和管理额度。".to_string(),
        );
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
    drop(db);
    let _ = app.emit("accounts-updated", ());
    request_session_sync();
    Ok(())
}

/// 账号库为空时，自动从 ~/.codex/auth.json 导入账号（仅支持 PAT / rt 两种格式）。
/// 无 auth.json、格式不支持或已有账号时不处理；导入成功返回账号。
#[tauri::command]
pub(crate) async fn import_account_from_auth_json(
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

    let home = dirs::home_dir().ok_or("无法获取用户主目录")?;
    let auth_path = home.join(".codex").join("auth.json");
    let Ok(content) = fs::read_to_string(&auth_path) else {
        return Ok(None); // 无 auth.json：不处理
    };

    let Some(credential) = resolve_auth_json_credential(&content) else {
        return Ok(None); // 格式不支持：不处理
    };

    let account = match credential {
        AuthJsonCredential::Pat(token) => insert_pat_account(&state, token, None).await?,
        AuthJsonCredential::RefreshToken(rt) => {
            // rt 兑换出 at 与账号信息后入库（rt 一次性使用）。
            let info = exchange_refresh_token(rt).await?;
            insert_rt_account(&state, info, None).await?
        }
    };
    eprintln!("[auth-import] 已自动导入账号：{}", account.name);
    Ok(Some(account))
}
