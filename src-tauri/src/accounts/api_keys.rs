use super::periods::ensure_account_period;
use super::usage::begin_account_refresh;
use super::{read_accounts, Account, ACCOUNT_SWITCH_LOCK};
use crate::auth::{
    account_type, apply_auth_json, build_api_key_auth_json, extract_openai_api_key,
    parse_openai_api_key, AccountType,
};
use crate::state::AppState;
use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use tauri::{Emitter, State};
use uuid::Uuid;

/// API Key 只保存和切换凭证，不读取订阅额度，也不在保存时发送计费请求。
#[tauri::command]
pub(crate) async fn save_api_key_account(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: Option<String>,
    name: String,
    api_key: String,
    notes: Option<String>,
) -> Result<Account, String> {
    let key = parse_openai_api_key(&api_key)?;
    let name = if name.trim().is_empty() {
        let suffix: String = key.chars().rev().take(4).collect::<Vec<_>>()
            .into_iter().rev().collect();
        format!("OpenAI API · {suffix}")
    } else {
        name.trim().to_string()
    };
    let _switch_guard = ACCOUNT_SWITCH_LOCK.try_lock()
        .map_err(|_| "正在切换账号并重启 Codex，请稍候。".to_string())?;
    let _refresh_guard = id.as_ref()
        .map(|id| begin_account_refresh(&state, id, None))
        .transpose()?;

    let (account, restart) = {
        let mut db = state.db.lock().map_err(|error| error.to_string())?;
        let existing = if let Some(id) = &id {
            let account: (String, bool) = db.query_row(
                "SELECT auth_json_content, is_active FROM accounts WHERE id = ?1",
                [id], |row| Ok((row.get(0)?, row.get(1)?)),
            ).optional().map_err(|error| error.to_string())?
                .ok_or("账号不存在")?;
            if account_type(&account.0) != AccountType::OpenaiApiKey {
                return Err("请选择 OpenAI API Key 账号进行编辑".to_string());
            }
            Some(account)
        } else {
            None
        };
        let is_active = match &existing {
            Some((_, active)) => *active,
            None => db.query_row(
                "SELECT COUNT(*) = 0 FROM accounts WHERE is_active = 1", [], |row| row.get(0),
            ).map_err(|error| error.to_string())?,
        };
        let credential_changed = existing.as_ref()
            .and_then(|(content, _)| extract_openai_api_key(content))
            .as_deref() != Some(key.as_str());
        let content = if !credential_changed {
            existing.as_ref().map(|(content, _)| content.clone())
                .unwrap_or_else(|| build_api_key_auth_json(&key))
        } else if api_key.trim().starts_with('{') {
            api_key.trim().to_string()
        } else {
            build_api_key_auth_json(&key)
        };
        let account_id = id.clone().unwrap_or_else(|| Uuid::new_v4().to_string());
        let now = Utc::now().to_rfc3339();
        let tx = db.transaction().map_err(|error| error.to_string())?;
        if existing.is_some() {
            tx.execute(
                "UPDATE accounts SET name = ?1, auth_json_content = ?2, notes = ?3, updated_at = ?4,
                 usage_json = NULL, usage_updated_at = NULL, next_refresh_at = NULL,
                 chatgpt_plan_type = NULL, access_token = NULL, refresh_token = NULL,
                 at_expires_at = NULL, chatgpt_account_id = NULL, reset_credits_json = NULL WHERE id = ?5",
                params![name, content, notes, now, account_id],
            ).map_err(|error| error.to_string())?;
        } else {
            tx.execute(
                "INSERT INTO accounts (id, name, auth_json_content, notes, created_at, updated_at, is_active, plan_type)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, 'weekly')",
                params![account_id, name, content, notes, now, is_active],
            ).map_err(|error| error.to_string())?;
        }
        let restart = is_active && credential_changed;
        if restart {
            apply_auth_json(&content)?;
            ensure_account_period(&tx, Some(&account_id), &now);
        }
        tx.commit().map_err(|error| error.to_string())?;
        if restart {
            crate::codex::events::pause_for_account_switch(&app);
        }
        let account = read_accounts(&db)?.accounts.into_iter()
            .find(|account| account.id == account_id).ok_or("账号保存失败")?;
        (account, restart)
    };
    let _ = app.emit("accounts-updated", ());
    if restart {
        crate::sessions::sync::request_session_sync();
        crate::codex::daemon::restart_after_account_switch(&app).await;
    }
    Ok(account)
}
