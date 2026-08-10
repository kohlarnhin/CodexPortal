use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension, Result as SqlResult};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{Emitter, Manager, State};
use uuid::Uuid;

const PERSONAL_ACCESS_TOKEN_METADATA_URL: &str =
    "https://auth.openai.com/api/accounts/v1/user-auth-credential/whoami";
const CODEX_USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
const USAGE_REFRESH_INTERVAL_SECONDS: i64 = 60 * 60;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountUsageWindow {
    #[serde(rename = "usedPercent")]
    pub used_percent: f64,
    #[serde(rename = "windowMinutes")]
    pub window_minutes: Option<i64>,
    #[serde(rename = "resetsAt")]
    pub resets_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountUsage {
    pub primary: Option<AccountUsageWindow>,
    pub secondary: Option<AccountUsageWindow>,
    #[serde(rename = "syncedAt")]
    pub synced_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub name: String,
    #[serde(rename = "authJsonContent")]
    pub auth_json_content: String,
    pub notes: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    #[serde(rename = "planType")]
    pub plan_type: String,
    pub usage: Option<AccountUsage>,
    #[serde(rename = "canRefreshUsage")]
    pub can_refresh_usage: bool,
    #[serde(rename = "nextRefreshAt")]
    pub next_refresh_at: Option<String>,
    #[serde(skip)]
    pub is_active: bool,
}

#[derive(Debug, Deserialize)]
struct PersonalAccessTokenMetadata {
    chatgpt_account_id: String,
    #[serde(default)]
    chatgpt_account_is_fedramp: bool,
}

#[derive(Debug, Deserialize)]
struct UsageApiResponse {
    #[serde(default)]
    rate_limit: Option<UsageRateLimitDetails>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountStore {
    #[serde(rename = "activeAccountId")]
    pub active_account_id: Option<String>,
    pub accounts: Vec<Account>,
}

pub struct AppState {
    pub db: Mutex<Connection>,
    /// 正在被手动刷新的账号 id，调度器跳过它们避免撞车。
    pub refreshing: Mutex<HashSet<String>>,
}

impl AppState {
    fn init_db(conn: &Connection) -> SqlResult<()> {
        conn.execute(
            "CREATE TABLE IF NOT EXISTS accounts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                auth_json_content TEXT NOT NULL,
                notes TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                is_active INTEGER NOT NULL,
                plan_type TEXT NOT NULL DEFAULT 'weekly',
                usage_json TEXT,
                usage_updated_at TEXT,
                next_refresh_at TEXT
            )",
            [],
        )?;

        let _ = conn.execute(
            "ALTER TABLE accounts ADD COLUMN plan_type TEXT NOT NULL DEFAULT 'weekly'",
            [],
        );
        let _ = conn.execute("ALTER TABLE accounts ADD COLUMN usage_json TEXT", []);
        let _ = conn.execute("ALTER TABLE accounts ADD COLUMN usage_updated_at TEXT", []);
        let _ = conn.execute("ALTER TABLE accounts ADD COLUMN next_refresh_at TEXT", []);

        conn.execute(
            "CREATE TABLE IF NOT EXISTS configs (
                key TEXT PRIMARY KEY,
                content TEXT NOT NULL
            )",
            [],
        )?;
        Ok(())
    }
}

fn extract_personal_access_token(auth_json_content: &str) -> Option<String> {
    let auth_json = serde_json::from_str::<Value>(auth_json_content).ok()?;
    auth_json
        .get("personal_access_token")?
        .as_str()
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(str::to_string)
}

fn parse_cached_usage(usage_json: Option<String>) -> Option<AccountUsage> {
    usage_json.and_then(|content| serde_json::from_str(&content).ok())
}

fn curl_config_quote(value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

fn append_curl_header(config: &mut String, name: &str, value: &str) -> Result<(), String> {
    if value.chars().any(char::is_control) {
        return Err("请求头包含无效字符".to_string());
    }

    config.push_str("header = ");
    config.push_str(&curl_config_quote(&format!("{name}: {value}")));
    config.push('\n');
    Ok(())
}

fn curl_get_json<T: DeserializeOwned>(
    url: &str,
    token: &str,
    account_id: Option<&str>,
    is_fedramp: bool,
) -> Result<T, String> {
    if token.chars().any(char::is_control) {
        return Err("Token 格式无效".to_string());
    }

    let mut config = String::from(
        "silent\nshow-error\nrequest = \"GET\"\nconnect-timeout = 10\nmax-time = 25\nproto = \"=https\"\n",
    );
    config.push_str("url = ");
    config.push_str(&curl_config_quote(url));
    config.push('\n');
    append_curl_header(&mut config, "Accept", "application/json")?;
    append_curl_header(&mut config, "Authorization", &format!("Bearer {token}"))?;
    append_curl_header(
        &mut config,
        "User-Agent",
        &format!("codex-portal/{}", env!("CARGO_PKG_VERSION")),
    )?;

    if let Some(account_id) = account_id {
        append_curl_header(&mut config, "ChatGPT-Account-ID", account_id)?;
    }
    if is_fedramp {
        append_curl_header(&mut config, "X-OpenAI-Fedramp", "true")?;
    }

    config.push_str("write-out = \"\\n%{http_code}\"\n");

    let mut command = if cfg!(target_os = "macos") {
        Command::new("/usr/bin/curl")
    } else if cfg!(target_os = "windows") {
        Command::new("curl.exe")
    } else {
        Command::new("/usr/bin/curl")
    };
    let mut child = command
        .arg("--config")
        .arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "无法启动系统网络请求工具".to_string())?;

    {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "无法创建安全的请求输入".to_string())?;
        stdin
            .write_all(config.as_bytes())
            .map_err(|_| "无法写入网络请求".to_string())?;
    }

    let output = child
        .wait_with_output()
        .map_err(|_| "网络请求未能完成".to_string())?;
    if !output.status.success() {
        return Err("网络请求失败，请检查网络连接".to_string());
    }

    let stdout =
        String::from_utf8(output.stdout).map_err(|_| "接口返回了无法识别的内容".to_string())?;
    let (body, status_text) = stdout
        .rsplit_once('\n')
        .ok_or_else(|| "接口响应格式异常".to_string())?;
    let status = status_text
        .trim()
        .parse::<u16>()
        .map_err(|_| "接口响应状态异常".to_string())?;

    if !(200..300).contains(&status) {
        return Err(match status {
            401 | 403 => "Token 无效或无权读取额度".to_string(),
            429 => "请求过于频繁，请稍后再试".to_string(),
            _ => format!("额度接口请求失败（HTTP {status}）"),
        });
    }

    serde_json::from_str(body).map_err(|_| "额度接口返回的数据格式异常".to_string())
}

fn normalize_usage_window(window: UsageApiWindow) -> AccountUsageWindow {
    AccountUsageWindow {
        used_percent: window.used_percent,
        window_minutes: window.limit_window_seconds.map(|seconds| seconds / 60),
        resets_at: window.reset_at,
    }
}

fn fetch_account_usage(token: &str) -> Result<AccountUsage, String> {
    let metadata = curl_get_json::<PersonalAccessTokenMetadata>(
        PERSONAL_ACCESS_TOKEN_METADATA_URL,
        token,
        None,
        false,
    )
    .map_err(|error| format!("Token 校验失败：{error}"))?;

    let response = curl_get_json::<UsageApiResponse>(
        CODEX_USAGE_URL,
        token,
        Some(&metadata.chatgpt_account_id),
        metadata.chatgpt_account_is_fedramp,
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
    })
}

/// 计算本次刷新成功后该账号的下次刷新时间。
///
/// 规则（以短周期 primary 窗口为准）：
/// - primary 剩余额度为 0（used_percent >= 100）→ 下次 = primary.resets_at + 1 分钟；
/// - 否则 → 下次 = 本次同步时间 + 1 小时。
///
/// 加 `now + 60s` 底线，防止 resets_at 已过或接口延迟导致热轮询。
fn compute_next_refresh_at(usage: &AccountUsage, now: DateTime<Utc>) -> DateTime<Utc> {
    let base = DateTime::parse_from_rfc3339(&usage.synced_at)
        .map(|synced| synced.with_timezone(&Utc) + chrono::Duration::seconds(USAGE_REFRESH_INTERVAL_SECONDS))
        .unwrap_or(now + chrono::Duration::seconds(USAGE_REFRESH_INTERVAL_SECONDS));

    let exhausted = usage
        .primary
        .as_ref()
        .map(|window| window.used_percent >= 100.0)
        .unwrap_or(false);

    let candidate = if exhausted {
        match usage.primary.as_ref().and_then(|window| window.resets_at) {
            Some(resets_at) => DateTime::from_timestamp(resets_at, 0)
                .map(|reset| reset + chrono::Duration::seconds(60))
                .unwrap_or(base),
            None => base,
        }
    } else {
        base
    };

    std::cmp::max(candidate, now + chrono::Duration::seconds(60))
}

fn persist_account_usage(
    db: &Connection,
    account_id: &str,
    expected_token: &str,
    usage: &AccountUsage,
) -> Result<(), String> {
    let auth_json_content = db
        .query_row(
            "SELECT auth_json_content FROM accounts WHERE id = ?1",
            params![account_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|_| "Account not found".to_string())?;
    if extract_personal_access_token(&auth_json_content).as_deref() != Some(expected_token) {
        return Err("账号认证已变更，请重新刷新额度".to_string());
    }

    let usage_json = serde_json::to_string(usage).map_err(|e| e.to_string())?;
    let next_refresh_at = compute_next_refresh_at(usage, Utc::now()).to_rfc3339();
    let rows_affected = db
        .execute(
            "UPDATE accounts SET usage_json = ?1, usage_updated_at = ?2, next_refresh_at = ?3 WHERE id = ?4",
            params![usage_json, usage.synced_at, next_refresh_at, account_id],
        )
        .map_err(|e| e.to_string())?;

    if rows_affected == 0 {
        return Err("Account not found".to_string());
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct AccountRefreshEvent {
    #[serde(rename = "accountId")]
    pub account_id: String,
}

#[tauri::command]
async fn refresh_account_usage(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<AccountUsage, String> {
    let token = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let auth_json_content = db
            .query_row(
                "SELECT auth_json_content FROM accounts WHERE id = ?1",
                params![id],
                |row| row.get::<_, String>(0),
            )
            .map_err(|_| "Account not found".to_string())?;
        extract_personal_access_token(&auth_json_content)
            .ok_or_else(|| "仅 Personal Access Token 账号支持额度刷新".to_string())?
    };

    {
        let mut refreshing = state.refreshing.lock().map_err(|e| e.to_string())?;
        refreshing.insert(id.clone());
    }

    let fetch_result = tauri::async_runtime::spawn_blocking({
        let token = token.clone();
        move || fetch_account_usage(&token)
    })
    .await
    .map_err(|e| format!("额度刷新任务失败：{e}"));

    let usage = match fetch_result {
        Ok(Ok(usage)) => usage,
        Ok(Err(error)) => {
            remove_from_refreshing(&*state, &id);
            return Err(error);
        }
        Err(error) => {
            remove_from_refreshing(&*state, &id);
            return Err(error);
        }
    };

    let persist_result = (|| {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        persist_account_usage(&db, &id, &token, &usage)
    })();
    remove_from_refreshing(&*state, &id);

    persist_result?;

    let _ = app.emit(
        "usage-updated",
        AccountRefreshEvent {
            account_id: id.clone(),
        },
    );

    Ok(usage)
}

fn remove_from_refreshing(state: &AppState, id: &str) {
    if let Ok(mut refreshing) = state.refreshing.lock() {
        refreshing.remove(id);
    }
}

/// 每个账号之间的刷新间隔（重启全量刷新时逐个执行）。
const USAGE_REFRESH_BATCH_SLEEP_SECONDS: u64 = 60;
/// 刷新失败后的重试间隔。
const USAGE_REFRESH_RETRY_SECONDS: i64 = 5 * 60;
/// 空闲时最长睡眠，保证能及时感知新增账号/手动刷新变化，同时精准到分钟。
const USAGE_REFRESH_MAX_SLEEP_SECONDS: u64 = 300;

fn schedule_retry(db: &Connection, id: &str) {
    let retry_at =
        (Utc::now() + chrono::Duration::seconds(USAGE_REFRESH_RETRY_SECONDS)).to_rfc3339();
    let _ = db.execute(
        "UPDATE accounts SET next_refresh_at = ?1 WHERE id = ?2",
        params![retry_at, id],
    );
}

/// 后台额度调度器：重启后沿用持久化的 next_refresh_at 计划，仅刷新已到期的账号
/// （逐个、间隔 1 分钟），避免重启触发不必要的频繁刷新。
fn start_usage_scheduler(app: tauri::AppHandle) {
    thread::spawn(move || {
        loop {
            let due: Vec<(String, String)> = {
                let state = app.state::<AppState>();
                let Ok(db) = state.db.lock() else {
                    thread::sleep(Duration::from_secs(30));
                    continue;
                };
                let now = Utc::now().to_rfc3339();
                let mut stmt = match db.prepare(
                    "SELECT id, auth_json_content FROM accounts WHERE next_refresh_at IS NULL OR next_refresh_at <= ?1 ORDER BY created_at ASC",
                ) {
                    Ok(stmt) => stmt,
                    Err(_) => {
                        thread::sleep(Duration::from_secs(30));
                        continue;
                    }
                };
                let mut due = Vec::new();
                let rows = stmt.query_map(params![now], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                });
                if let Ok(rows) = rows {
                    for (id, auth_json_content) in rows.flatten() {
                        if let Some(token) = extract_personal_access_token(&auth_json_content) {
                            due.push((id, token));
                        }
                    }
                }
                due
            };

            for (id, token) in due {
                let state = app.state::<AppState>();
                let refreshing = state
                    .refreshing
                    .lock()
                    .map(|refreshing| refreshing.contains(&id))
                    .unwrap_or(false);
                if refreshing {
                    continue;
                }

                let _ = app.emit(
                    "usage-refresh-started",
                    AccountRefreshEvent {
                        account_id: id.clone(),
                    },
                );

                let result = fetch_account_usage(&token);

                match result {
                    Ok(usage) => {
                        let ok = {
                            let state = app.state::<AppState>();
                            let persisted = match state.db.lock() {
                                Ok(db) => persist_account_usage(&db, &id, &token, &usage).is_ok(),
                                Err(_) => false,
                            };
                            persisted
                        };
                        if ok {
                            eprintln!("[usage-scheduler] 刷新成功 {id}");
                            let _ = app.emit(
                                "usage-updated",
                                AccountRefreshEvent {
                                    account_id: id.clone(),
                                },
                            );
                        } else {
                            eprintln!("[usage-scheduler] 持久化失败 {id}");
                            if let Ok(db) = state.db.lock() {
                                schedule_retry(&db, &id);
                            }
                        }
                    }
                    Err(error) => {
                        eprintln!("[usage-scheduler] 刷新失败 {id}: {error}");
                        if let Ok(db) = state.db.lock() {
                            schedule_retry(&db, &id);
                        }
                    }
                }

                let _ = app.emit(
                    "usage-refresh-finished",
                    AccountRefreshEvent {
                        account_id: id.clone(),
                    },
                );

                thread::sleep(Duration::from_secs(USAGE_REFRESH_BATCH_SLEEP_SECONDS));
            }

            // 睡到最早的未来刷新时间（精确触发），最多 5 分钟醒一次。
            let sleep_secs = {
                let state = app.state::<AppState>();
                let now = Utc::now();
                let earliest: Option<String> = match state.db.lock() {
                    Ok(db) => db
                        .query_row(
                            "SELECT MIN(next_refresh_at) FROM accounts WHERE next_refresh_at IS NOT NULL",
                            [],
                            |row| row.get(0),
                        )
                        .unwrap_or(None),
                    Err(_) => None,
                };
                match earliest {
                    Some(ts) => match DateTime::parse_from_rfc3339(&ts) {
                        Ok(next) if next.with_timezone(&Utc) > now => {
                            let secs = (next.with_timezone(&Utc) - now).num_seconds();
                            secs.clamp(1, USAGE_REFRESH_MAX_SLEEP_SECONDS as i64) as u64
                        }
                        _ => 30,
                    },
                    None => USAGE_REFRESH_MAX_SLEEP_SECONDS,
                }
            };
            thread::sleep(Duration::from_secs(sleep_secs));
        }
    });
}

#[tauri::command]
fn get_accounts(state: State<'_, AppState>) -> Result<AccountStore, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    let mut stmt = db.prepare("SELECT id, name, auth_json_content, notes, created_at, updated_at, is_active, plan_type, usage_json, next_refresh_at FROM accounts ORDER BY is_active DESC, created_at ASC").map_err(|e| e.to_string())?;
    let account_iter = stmt
        .query_map([], |row| {
            let auth_json_content: String = row.get(2)?;
            Ok(Account {
                id: row.get(0)?,
                name: row.get(1)?,
                can_refresh_usage: extract_personal_access_token(&auth_json_content).is_some(),
                auth_json_content,
                notes: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                is_active: row.get::<_, i32>(6)? == 1,
                plan_type: row.get(7)?,
                usage: parse_cached_usage(row.get(8)?),
                next_refresh_at: row.get(9)?,
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

#[tauri::command]
fn add_account(
    state: State<'_, AppState>,
    name: String,
    auth_json_content: String,
    notes: Option<String>,
    plan_type: String,
) -> Result<Account, String> {
    let now = Utc::now().to_rfc3339();
    let can_refresh_usage = extract_personal_access_token(&auth_json_content).is_some();
    let account = Account {
        id: Uuid::new_v4().to_string(),
        name,
        auth_json_content,
        notes,
        created_at: now.clone(),
        updated_at: now,
        plan_type: plan_type.clone(),
        usage: None,
        can_refresh_usage,
        next_refresh_at: None,
        is_active: false,
    };

    let mut db = state.db.lock().map_err(|e| e.to_string())?;

    let count: i32 = db
        .query_row("SELECT COUNT(*) FROM accounts", [], |row| row.get(0))
        .unwrap_or(0);
    let mut account_to_return = account.clone();
    account_to_return.is_active = count == 0;

    let tx = db.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO accounts (id, name, auth_json_content, notes, created_at, updated_at, is_active, plan_type) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![account.id, account.name, account.auth_json_content, account.notes, account.created_at, account.updated_at, if count == 0 { 1 } else { 0 }, plan_type],
    ).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;

    if count == 0 {
        let _ = apply_auth_json(&account.auth_json_content);
    }

    Ok(account_to_return)
}

#[tauri::command]
fn update_account(
    state: State<'_, AppState>,
    id: String,
    name: String,
    auth_json_content: String,
    notes: Option<String>,
    plan_type: String,
) -> Result<Account, String> {
    let now = Utc::now().to_rfc3339();
    let mut db = state.db.lock().map_err(|e| e.to_string())?;

    let tx = db.transaction().map_err(|e| e.to_string())?;

    let (existing_auth_json_content, existing_usage_json, existing_usage_updated_at, existing_next_refresh_at, is_active): (String, Option<String>, Option<String>, Option<String>, i32) = tx
        .query_row(
            "SELECT auth_json_content, usage_json, usage_updated_at, next_refresh_at, is_active FROM accounts WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )
        .map_err(|_| "Account not found".to_string())?;

    let auth_changed = existing_auth_json_content != auth_json_content;
    let usage_json = if auth_changed {
        None
    } else {
        existing_usage_json
    };
    let usage_updated_at = if auth_changed {
        None
    } else {
        existing_usage_updated_at
    };
    let next_refresh_at = if auth_changed {
        None
    } else {
        existing_next_refresh_at
    };

    let rows_affected = tx.execute(
        "UPDATE accounts SET name = ?1, auth_json_content = ?2, notes = ?3, updated_at = ?4, plan_type = ?5, usage_json = ?6, usage_updated_at = ?7, next_refresh_at = ?8 WHERE id = ?9",
        params![name, auth_json_content, notes, now, plan_type, usage_json, usage_updated_at, next_refresh_at, id],
    ).map_err(|e| e.to_string())?;

    if rows_affected == 0 {
        return Err("Account not found".to_string());
    }

    tx.commit().map_err(|e| e.to_string())?;

    if is_active == 1 {
        let _ = apply_auth_json(&auth_json_content);
    }

    let can_refresh_usage = extract_personal_access_token(&auth_json_content).is_some();

    Ok(Account {
        id,
        name,
        auth_json_content,
        notes,
        created_at: "".to_string(), // Frontend doesn't need to update created_at usually
        updated_at: now,
        plan_type,
        usage: parse_cached_usage(usage_json),
        can_refresh_usage,
        next_refresh_at,
        is_active: is_active == 1,
    })
}

#[tauri::command]
fn delete_account(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let tx = db.transaction().map_err(|e| e.to_string())?;

    let is_active: i32 = tx
        .query_row(
            "SELECT is_active FROM accounts WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    tx.execute("DELETE FROM accounts WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;

    if is_active == 1 {
        let next_id: Option<String> = tx
            .query_row("SELECT id FROM accounts LIMIT 1", [], |row| row.get(0))
            .optional()
            .unwrap_or(None);
        if let Some(nid) = next_id {
            tx.execute(
                "UPDATE accounts SET is_active = 1 WHERE id = ?1",
                params![nid],
            )
            .unwrap_or(0);
            if let Ok(content) = tx.query_row(
                "SELECT auth_json_content FROM accounts WHERE id = ?1",
                params![nid],
                |row| row.get::<_, String>(0),
            ) {
                let _ = apply_auth_json(&content);
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn set_active_account(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let tx = db.transaction().map_err(|e| e.to_string())?;

    let content: String = tx
        .query_row(
            "SELECT auth_json_content FROM accounts WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|_| "Account not found".to_string())?;

    tx.execute("UPDATE accounts SET is_active = 0", [])
        .map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE accounts SET is_active = 1 WHERE id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    apply_auth_json(&content)?;
    Ok(())
}

fn apply_auth_json(content: &str) -> Result<(), String> {
    let home_dir = dirs::home_dir().ok_or("Could not find home directory")?;
    let codex_dir = home_dir.join(".codex");

    if !codex_dir.exists() {
        fs::create_dir_all(&codex_dir)
            .map_err(|e| format!("Failed to create ~/.codex directory: {}", e))?;
    }

    let auth_file_path = codex_dir.join("auth.json");
    fs::write(&auth_file_path, content).map_err(|e| format!("Failed to write auth.json: {}", e))?;

    Ok(())
}

fn get_local_file_content(path: &PathBuf) -> Option<String> {
    if path.exists() {
        fs::read_to_string(path).ok()
    } else {
        None
    }
}

#[tauri::command]
fn get_codex_config(state: State<'_, AppState>) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    let db_content: Option<String> = db
        .query_row(
            "SELECT content FROM configs WHERE key = 'codex_config'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some(content) = db_content {
        return Ok(content);
    }

    let home_dir = dirs::home_dir().ok_or("Could not find home directory")?;
    let config_path = home_dir.join(".codex").join("config.toml");

    if let Some(local_content) = get_local_file_content(&config_path) {
        db.execute(
            "INSERT INTO configs (key, content) VALUES ('codex_config', ?1)",
            params![local_content],
        )
        .map_err(|e| e.to_string())?;
        return Ok(local_content);
    }

    Err("No configuration found in DB or local".to_string())
}

#[tauri::command]
fn save_codex_config(state: State<'_, AppState>, content: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    db.execute(
        "INSERT INTO configs (key, content) VALUES ('codex_config', ?1) ON CONFLICT(key) DO UPDATE SET content = ?1",
        params![content],
    ).map_err(|e| e.to_string())?;

    let home_dir = dirs::home_dir().ok_or("Could not find home directory")?;
    let codex_dir = home_dir.join(".codex");

    if !codex_dir.exists() {
        fs::create_dir_all(&codex_dir)
            .map_err(|e| format!("Failed to create ~/.codex directory: {}", e))?;
    }

    let config_path = codex_dir.join("config.toml");
    fs::write(&config_path, content).map_err(|e| format!("Failed to write config.toml: {}", e))?;

    Ok(())
}

#[derive(Serialize, Deserialize)]
pub struct ConsistencyCheckResult {
    is_consistent: bool,
    db_content: Option<String>,
    local_content: Option<String>,
}

#[tauri::command]
fn check_config_consistency(
    state: State<'_, AppState>,
    config_type: String,
) -> Result<ConsistencyCheckResult, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let key = match config_type.as_str() {
        "codex" => "codex_config",
        "mcp" => "mcp_config",
        _ => return Err("Unknown config type".to_string()),
    };

    let db_content: Option<String> = db
        .query_row(
            "SELECT content FROM configs WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let home_dir = dirs::home_dir().ok_or("Could not find home directory")?;
    let file_path = match config_type.as_str() {
        "codex" => home_dir.join(".codex").join("config.toml"),
        "mcp" => home_dir.join(".codex").join("mcp.json"),
        _ => PathBuf::new(),
    };

    let local_content = get_local_file_content(&file_path);

    let is_consistent = match (&db_content, &local_content) {
        (Some(db), Some(local)) => db == local,
        (None, None) => true,
        _ => false,
    };

    Ok(ConsistencyCheckResult {
        is_consistent,
        db_content,
        local_content,
    })
}

#[cfg(target_os = "macos")]
fn add_existing_cli_path(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if path.is_dir() && !paths.contains(&path) {
        paths.push(path);
    }
}

#[cfg(target_os = "macos")]
fn macos_cli_search_path() -> Option<std::ffi::OsString> {
    // Apps launched by Finder inherit a minimal PATH from LaunchServices instead
    // of the user's terminal PATH, so include common CLI installation locations.
    let mut paths = std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect::<Vec<_>>())
        .unwrap_or_default();

    for path in ["/opt/homebrew/bin", "/usr/local/bin"] {
        add_existing_cli_path(&mut paths, PathBuf::from(path));
    }

    if let Some(home_dir) = dirs::home_dir() {
        for path in [
            home_dir.join(".local/bin"),
            home_dir.join(".npm-global/bin"),
            home_dir.join(".volta/bin"),
            home_dir.join(".asdf/shims"),
            home_dir.join(".local/share/mise/shims"),
            home_dir.join(".bun/bin"),
        ] {
            add_existing_cli_path(&mut paths, path);
        }
    }

    std::env::join_paths(paths).ok()
}

fn codex_command() -> Command {
    let mut command = Command::new("codex");

    #[cfg(target_os = "macos")]
    if let Some(path) = macos_cli_search_path() {
        command.env("PATH", path);
    }

    command
}

#[tauri::command]
async fn get_codex_version() -> Result<String, String> {
    let output = codex_command().arg("--version").output().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            format!(
                "未找到 Codex CLI（{}）。请确认已安装 Codex，并可在终端执行 `codex --version`。",
                error
            )
        } else {
            format!("启动 Codex CLI 失败：{}", error)
        }
    })?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[cfg(desktop)]
fn show_main_window<R: tauri::Runtime>(app_handle: &tauri::AppHandle<R>) {
    #[cfg(target_os = "macos")]
    let _ = app_handle.show();

    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                let _ = window.hide();
                api.prevent_close();
            }
            _ => {}
        })
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");
            fs::create_dir_all(&app_data_dir).expect("Failed to create app data directory");

            let db_path = app_data_dir.join("database.sqlite");
            let conn = Connection::open(&db_path).expect("Failed to open SQLite database");

            AppState::init_db(&conn).expect("Failed to initialize database schema");

            app.manage(AppState {
                db: Mutex::new(conn),
                refreshing: Mutex::new(HashSet::new()),
            });

            start_usage_scheduler(app.handle().clone());

            #[cfg(desktop)]
            show_main_window(app.handle());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_accounts,
            add_account,
            update_account,
            delete_account,
            set_active_account,
            refresh_account_usage,
            get_codex_config,
            save_codex_config,
            get_codex_version,
            check_config_consistency,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen {
            has_visible_windows,
            ..
        } => {
            if !has_visible_windows {
                show_main_window(app_handle);
            }
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utc_ts(iso: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(iso)
            .unwrap()
            .with_timezone(&Utc)
    }

    fn usage(used_percent: f64, resets_at: Option<i64>) -> AccountUsage {
        AccountUsage {
            primary: Some(AccountUsageWindow {
                used_percent,
                window_minutes: Some(300),
                resets_at,
            }),
            secondary: None,
            synced_at: "2026-08-07T10:00:00Z".to_string(),
        }
    }

    #[test]
    fn not_exhausted_uses_next_hour() {
        let now = utc_ts("2026-08-07T10:00:00Z");
        let next = compute_next_refresh_at(&usage(40.0, None), now);
        assert_eq!(next, utc_ts("2026-08-07T11:00:00Z"));
    }

    #[test]
    fn exhausted_with_future_reset_uses_reset_plus_minute() {
        let now = utc_ts("2026-08-07T10:00:00Z");
        let resets_at = now.timestamp() + 600; // 10:10
        let next = compute_next_refresh_at(&usage(100.0, Some(resets_at)), now);
        assert_eq!(next, utc_ts("2026-08-07T10:11:00Z"));
    }

    #[test]
    fn exhausted_without_reset_falls_back_to_next_hour() {
        let now = utc_ts("2026-08-07T10:00:00Z");
        let next = compute_next_refresh_at(&usage(100.0, None), now);
        assert_eq!(next, utc_ts("2026-08-07T11:00:00Z"));
    }

    #[test]
    fn exhausted_with_past_reset_is_floored_to_next_minute() {
        let now = utc_ts("2026-08-07T10:00:00Z");
        let resets_at = now.timestamp() - 600; // 已过
        let next = compute_next_refresh_at(&usage(100.0, Some(resets_at)), now);
        assert_eq!(next, utc_ts("2026-08-07T10:01:00Z"));
    }

    #[test]
    fn missing_primary_uses_next_hour() {
        let now = utc_ts("2026-08-07T10:00:00Z");
        let usage = AccountUsage {
            primary: None,
            secondary: None,
            synced_at: "2026-08-07T10:00:00Z".to_string(),
        };
        let next = compute_next_refresh_at(&usage, now);
        assert_eq!(next, utc_ts("2026-08-07T11:00:00Z"));
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
                next_refresh_at TEXT
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
            primary: Some(AccountUsageWindow {
                used_percent: 100.0,
                window_minutes: Some(300),
                resets_at: Some(resets_at),
            }),
            secondary: None,
            synced_at: now.to_rfc3339(),
        };

        persist_account_usage(&conn, "a1", "sk-test-token", &usage).unwrap();

        let expected =
            (DateTime::from_timestamp(resets_at, 0).unwrap() + chrono::Duration::seconds(60))
                .to_rfc3339();
        let next: Option<String> = conn
            .query_row("SELECT next_refresh_at FROM accounts WHERE id = 'a1'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(next.as_deref(), Some(expected.as_str()));
    }
}
