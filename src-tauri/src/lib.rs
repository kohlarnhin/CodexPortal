use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, Utc};
use rand::RngCore;
use rusqlite::{params, Connection, OptionalExtension, Result as SqlResult};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use tauri::{Emitter, Manager, State};
use uuid::Uuid;

const PERSONAL_ACCESS_TOKEN_METADATA_URL: &str =
    "https://auth.openai.com/api/accounts/v1/user-auth-credential/whoami";
const CODEX_USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
const CODEX_RESPONSES_URL: &str = "https://chatgpt.com/backend-api/codex/responses";
const RESET_CREDITS_URL: &str = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
const OAUTH_TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
/// Codex CLI 登录使用的 OAuth client_id（/oauth/token 必需）。
const OAUTH_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const TEST_MESSAGE_CONTENT: &str = "Introduce yourself.";

/// 启动时获取并缓存的 Codex CLI 版本号（用于 User-Agent）。
static CODEX_VERSION: OnceLock<String> = OnceLock::new();

/// 构造与 Codex CLI 一致的 User-Agent（originator/版本/系统/架构）。
/// 版本号使用启动时获取并保存的 Codex CLI 版本；未获取到时回退为本应用版本。
fn codex_cli_user_agent() -> String {
    let version = CODEX_VERSION
        .get()
        .map(String::as_str)
        .unwrap_or(env!("CARGO_PKG_VERSION"));
    format!(
        "codex_cli_rs/{version} ({}; {})",
        std::env::consts::OS,
        std::env::consts::ARCH
    )
}
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
    /// 额度接口返回的订阅类型，仅内部用于更新账号 chatgpt_plan_type，不序列化。
    #[serde(skip)]
    pub plan_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResetCredit {
    pub id: Option<String>,
    pub status: Option<String>,
    #[serde(rename = "resetType")]
    pub reset_type: Option<String>,
    #[serde(rename = "expiresAt")]
    pub expires_at: Option<i64>,
    #[serde(rename = "grantedAt")]
    pub granted_at: Option<i64>,
    #[serde(rename = "redeemedAt")]
    pub redeemed_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResetCreditsInfo {
    #[serde(rename = "availableCount")]
    pub available_count: i64,
    pub credits: Vec<ResetCredit>,
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
    #[serde(rename = "chatgptPlanType")]
    pub chatgpt_plan_type: Option<String>,
    #[serde(rename = "hasAccessToken")]
    pub has_access_token: bool,
    #[serde(rename = "resetCredits")]
    pub reset_credits: Option<ResetCreditsInfo>,
    #[serde(skip)]
    pub is_active: bool,
    #[serde(skip)]
    pub access_token: Option<String>,
    #[serde(skip)]
    pub chatgpt_account_id: Option<String>,
    #[serde(skip)]
    pub chatgpt_account_is_fedramp: bool,
    #[serde(skip)]
    pub refresh_token: Option<String>,
    #[serde(skip)]
    pub at_expires_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PersonalAccessTokenMetadata {
    chatgpt_account_id: String,
    #[serde(default)]
    chatgpt_account_is_fedramp: bool,
    #[serde(default)]
    chatgpt_plan_type: String,
    #[serde(default)]
    email: String,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountStore {
    #[serde(rename = "activeAccountId")]
    pub active_account_id: Option<String>,
    pub accounts: Vec<Account>,
}

/// 一次 OAuth 登录的临时会话状态（本地回调 + 待兑换的 code）。
#[derive(Default)]
pub struct OAuthSession {
    pub code_verifier: Option<String>,
    pub state: Option<String>,
    pub redirect_uri: Option<String>,
    pub callback_code: Option<String>,
}

pub struct AppState {
    pub db: Mutex<Connection>,
    /// 正在被手动刷新的账号 id，调度器跳过它们避免撞车。
    pub refreshing: Mutex<HashSet<String>>,
    /// OAuth 登录会话。
    pub oauth: Mutex<OAuthSession>,
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
                next_refresh_at TEXT,
                chatgpt_plan_type TEXT,
                access_token TEXT,
                chatgpt_account_id TEXT,
                chatgpt_account_is_fedramp INTEGER NOT NULL DEFAULT 0,
                reset_credits_json TEXT,
                refresh_token TEXT,
                at_expires_at TEXT
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
        let _ = conn.execute("ALTER TABLE accounts ADD COLUMN chatgpt_plan_type TEXT", []);
        let _ = conn.execute("ALTER TABLE accounts ADD COLUMN access_token TEXT", []);
        let _ = conn.execute("ALTER TABLE accounts ADD COLUMN chatgpt_account_id TEXT", []);
        let _ = conn.execute(
            "ALTER TABLE accounts ADD COLUMN chatgpt_account_is_fedramp INTEGER NOT NULL DEFAULT 0",
            [],
        );
        let _ = conn.execute("ALTER TABLE accounts ADD COLUMN reset_credits_json TEXT", []);
        let _ = conn.execute("ALTER TABLE accounts ADD COLUMN refresh_token TEXT", []);
        let _ = conn.execute("ALTER TABLE accounts ADD COLUMN at_expires_at TEXT", []);

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

/// 执行一条 curl 配置并返回响应体与 HTTP 状态码。
fn run_curl(config: &str) -> Result<(String, u16), String> {
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
        .stderr(Stdio::piped())
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
        let exit_code = output.status.code().unwrap_or(-1);
        let detail = String::from_utf8_lossy(&output.stderr)
            .lines()
            .find(|line| !line.trim().is_empty())
            .map(|line| line.trim().to_string())
            .unwrap_or_else(|| "未知原因".to_string());
        return Err(format!("网络请求失败（exit {exit_code}）：{detail}"));
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

    Ok((body.to_string(), status))
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
        &codex_cli_user_agent(),
    )?;

    if let Some(account_id) = account_id {
        append_curl_header(&mut config, "ChatGPT-Account-ID", account_id)?;
    }
    if is_fedramp {
        append_curl_header(&mut config, "X-OpenAI-Fedramp", "true")?;
    }

    config.push_str("write-out = \"\\n%{http_code}\"\n");

    let (body, status) = run_curl(&config)?;
    if !(200..300).contains(&status) {
        return Err(match status {
            401 | 403 => "Token 无效或无权读取额度".to_string(),
            429 => "请求过于频繁，请稍后再试".to_string(),
            _ => format!("额度接口请求失败（HTTP {status}）"),
        });
    }

    serde_json::from_str(&body).map_err(|_| "额度接口返回的数据格式异常".to_string())
}

/// 向 Codex 后端 POST JSON 并**流式读取** SSE 响应。
///
/// 逐行读取，遇到 `response.output_text.delta` 立即通过 `test-output-delta` 事件推送给前端，
/// 结束时返回完整输出文本。请求头按 Codex CLI 调用 `chatgpt.com/backend-api/codex/responses`
/// 的要求设置（`OpenAI-Beta`、`originator`、`Accept: text/event-stream`）。
fn curl_post_stream(
    app: &tauri::AppHandle,
    url: &str,
    token: &str,
    chatgpt_account_id: &str,
    event_account_id: &str,
    is_fedramp: bool,
    body: &str,
) -> Result<String, String> {
    if token.chars().any(char::is_control) {
        return Err("Token 格式无效".to_string());
    }

    let mut config = String::from(
        "silent\nshow-error\nno-buffer\nrequest = \"POST\"\nconnect-timeout = 10\nmax-time = 60\nproto = \"=https\"\n",
    );
    config.push_str("url = ");
    config.push_str(&curl_config_quote(url));
    config.push('\n');
    append_curl_header(&mut config, "Accept", "text/event-stream")?;
    append_curl_header(&mut config, "Content-Type", "application/json")?;
    append_curl_header(&mut config, "Authorization", &format!("Bearer {token}"))?;
    append_curl_header(&mut config, "OpenAI-Beta", "responses=experimental")?;
    append_curl_header(&mut config, "originator", "codex_cli_rs")?;
    append_curl_header(
        &mut config,
        "User-Agent",
        &codex_cli_user_agent(),
    )?;
    append_curl_header(&mut config, "ChatGPT-Account-ID", chatgpt_account_id)?;
    if is_fedramp {
        append_curl_header(&mut config, "X-OpenAI-Fedramp", "true")?;
    }
    // data-raw 会原样发送请求体（不会按表单编码）；body 不是 curl 合法配置项（会导致 exit 26）。
    config.push_str("data-raw = ");
    config.push_str(&curl_config_quote(body));
    config.push('\n');
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
        .stderr(Stdio::piped())
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

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取接口响应".to_string())?;
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    let mut raw_body = String::new();
    let mut status: Option<u16> = None;

    loop {
        line.clear();
        let bytes = reader
            .read_line(&mut line)
            .map_err(|_| "读取接口响应失败".to_string())?;
        if bytes == 0 {
            break;
        }
        raw_body.push_str(&line);
        let trimmed = line.trim_end();

        // write-out 追加的状态码行（形如 "200"）。
        if trimmed.len() == 3 && trimmed.chars().all(|c| c.is_ascii_digit()) {
            if let Ok(code) = trimmed.parse::<u16>() {
                status = Some(code);
            }
            continue;
        }

        if let Some(data) = trimmed.strip_prefix("data:") {
            if let Ok(event) = serde_json::from_str::<Value>(data.trim()) {
                if event.get("type").and_then(|value| value.as_str()) == Some("response.output_text.delta")
                {
                    if let Some(delta) = event.get("delta").and_then(|value| value.as_str()) {
                        let _ = app.emit(
                            "test-output-delta",
                            TestOutputDelta {
                                account_id: event_account_id.to_string(),
                                delta: delta.to_string(),
                            },
                        );
                    }
                }
            }
        }
    }

    let output = child
        .wait_with_output()
        .map_err(|_| "网络请求未能完成".to_string())?;
    if !output.status.success() && status.is_none() {
        let exit_code = output.status.code().unwrap_or(-1);
        let detail = String::from_utf8_lossy(&output.stderr)
            .lines()
            .find(|item| !item.trim().is_empty())
            .map(|item| item.trim().to_string())
            .unwrap_or_else(|| "未知原因".to_string());
        return Err(format!("网络请求失败（exit {exit_code}）：{detail}"));
    }

    if let Some(code) = status {
        if !(200..300).contains(&code) {
            return Err(build_test_error(code, &raw_body));
        }
    }

    Ok(extract_responses_output_from_body(&raw_body))
}

#[derive(Debug, Deserialize)]
struct ResetCreditApi {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    reset_type: Option<String>,
    #[serde(default)]
    expires_at: Option<serde_json::Value>,
    #[serde(default)]
    granted_at: Option<serde_json::Value>,
    #[serde(default)]
    redeemed_at: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct ResetCreditsApiResponse {
    #[serde(default)]
    credits: Vec<ResetCreditApi>,
    #[serde(default)]
    available_count: Option<i64>,
}

/// 将接口返回的时间（秒/毫秒时间戳或 ISO 字符串）归一化为 Unix 秒。
fn normalize_timestamp(value: &serde_json::Value) -> Option<i64> {
    match value {
        serde_json::Value::Number(number) => {
            let v = number.as_i64()?;
            Some(if v > 1_000_000_000_000 { v / 1000 } else { v })
        }
        serde_json::Value::String(text) => {
            if let Ok(v) = text.parse::<i64>() {
                Some(if v > 1_000_000_000_000 { v / 1000 } else { v })
            } else {
                DateTime::parse_from_rfc3339(text)
                    .ok()
                    .map(|date| date.with_timezone(&Utc).timestamp())
            }
        }
        _ => None,
    }
}

/// 获取账号的银行式重置卡（RateLimitResetCredit）信息。
/// 需要 ChatGPT OAuth access_token（at），PAT 无法获取。
fn fetch_reset_credits(
    at: &str,
    account_id: Option<&str>,
    is_fedramp: bool,
) -> Result<ResetCreditsInfo, String> {
    if at.chars().any(char::is_control) {
        return Err("Access Token 格式无效".to_string());
    }

    let mut config = String::from(
        "silent\nshow-error\nrequest = \"GET\"\nconnect-timeout = 10\nmax-time = 25\nproto = \"=https\"\n",
    );
    config.push_str("url = ");
    config.push_str(&curl_config_quote(RESET_CREDITS_URL));
    config.push('\n');
    append_curl_header(&mut config, "Accept", "application/json")?;
    append_curl_header(&mut config, "Authorization", &format!("Bearer {at}"))?;
    append_curl_header(&mut config, "originator", "Codex Desktop")?;
    append_curl_header(&mut config, "OAI-Product-Sku", "CODEX")?;
    append_curl_header(
        &mut config,
        "User-Agent",
        &codex_cli_user_agent(),
    )?;
    if let Some(account_id) = account_id {
        append_curl_header(&mut config, "ChatGPT-Account-Id", account_id)?;
    }
    if is_fedramp {
        append_curl_header(&mut config, "X-OpenAI-Fedramp", "true")?;
    }
    config.push_str("write-out = \"\\n%{http_code}\"\n");

    let (body, status) = run_curl(&config)?;
    if !(200..300).contains(&status) {
        return Err(format!("获取重置卡失败（HTTP {status}）"));
    }

    let response: ResetCreditsApiResponse =
        serde_json::from_str(&body).map_err(|_| "重置卡接口返回的数据格式异常".to_string())?;

    let credits = response
        .credits
        .iter()
        .map(|credit| ResetCredit {
            id: credit.id.clone(),
            status: credit.status.clone(),
            reset_type: credit.reset_type.clone(),
            expires_at: credit.expires_at.as_ref().and_then(normalize_timestamp),
            granted_at: credit.granted_at.as_ref().and_then(normalize_timestamp),
            redeemed_at: credit.redeemed_at.as_ref().and_then(normalize_timestamp),
        })
        .collect::<Vec<_>>();

    let available_count = response.available_count.unwrap_or_else(|| {
        credits
            .iter()
            .filter(|credit| {
                credit
                    .status
                    .as_deref()
                    .map(|status| status.eq_ignore_ascii_case("available"))
                    .unwrap_or(false)
            })
            .count() as i64
    });

    Ok(ResetCreditsInfo {
        available_count,
        credits,
        synced_at: Utc::now().to_rfc3339(),
    })
}

/// 构造测试请求失败的友好错误信息。
fn build_test_error(status: u16, body: &str) -> String {
    let api_message = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(|message| message.as_str())
                .map(str::to_string)
        })
        .filter(|message| !message.trim().is_empty());

    if let Some(message) = api_message {
        return format!("测试请求失败（HTTP {status}）：{message}");
    }

    let generic = match status {
        401 | 403 => "Token 无效或无权调用".to_string(),
        429 => "请求过于频繁，请稍后再试".to_string(),
        _ => String::new(),
    };
    if !generic.is_empty() {
        return format!("测试请求失败（HTTP {status}）：{generic}");
    }

    let truncated: String = body.chars().take(500).collect();
    if !truncated.trim().is_empty() {
        let suffix = if body.chars().count() > 500 { "…" } else { "" };
        return format!("测试请求失败（HTTP {status}）：{truncated}{suffix}");
    }
    format!("测试请求失败（HTTP {status}）")
}

fn normalize_usage_window(window: UsageApiWindow) -> AccountUsageWindow {
    AccountUsageWindow {
        used_percent: window.used_percent,
        window_minutes: window.limit_window_seconds.map(|seconds| seconds / 60),
        resets_at: window.reset_at,
    }
}

/// 解析账号额度请求用的 bearer、账号 ID、FedRAMP 与是否允许 whoami：
/// - rt 账号（有 refresh_token）：用 at + 存库 account_id（跳过 whoami，whoami 拒绝 at）；
/// - PAT 账号：用 PAT，account_id 运行时经 whoami 获取。
fn account_usage_context(
    auth_json_content: &str,
    access_token: Option<&str>,
    refresh_token: Option<&str>,
    chatgpt_account_id: Option<&str>,
    chatgpt_account_is_fedramp: bool,
) -> (Option<String>, Option<String>, bool, bool) {
    if access_token.is_some() && refresh_token.is_some() {
        return (
            access_token.map(str::to_string),
            chatgpt_account_id.map(str::to_string),
            chatgpt_account_is_fedramp,
            false,
        );
    }
    (extract_personal_access_token(auth_json_content), None, false, true)
}

fn fetch_account_usage(
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
        plan_type: response.plan_type,
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
            params![usage_json, usage.synced_at, next_refresh_at, plan_type, chatgpt_plan_type, account_id],
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

/// at 是否临近/已过期（需用 rt 刷新）。
fn at_is_due(at_expires_at: &Option<String>) -> bool {
    let Some(value) = at_expires_at else {
        return false;
    };
    let Ok(expires) = DateTime::parse_from_rfc3339(value) else {
        return false;
    };
    expires.with_timezone(&Utc) <= Utc::now() + chrono::Duration::minutes(5)
}

#[tauri::command]
async fn refresh_account_usage(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<AccountUsage, String> {
    // 读取账号认证上下文。
    let (auth_json_content, access_token, refresh_token, chatgpt_account_id, fedramp, at_expires_at) = {
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

    // rt 账号且 at 临近过期：先用 rt 兑换新 at（rt 一次性使用，保存新 rt）。
    if refresh_token.is_some() && at_is_due(&at_expires_at) {
        if let Some(rt) = refresh_token {
            let info = tauri::async_runtime::spawn_blocking(move || exchange_rt_for_at(&rt))
                .await
                .map_err(|e| format!("刷新 Access Token 任务失败：{e}"))??;
            let new_expiry =
                DateTime::from_timestamp(info.at_expires_at, 0).map(|time| time.to_rfc3339());
            {
                let db = state.db.lock().map_err(|e| e.to_string())?;
                let _ = db.execute(
                    "UPDATE accounts SET access_token = ?1, refresh_token = ?2, at_expires_at = ?3, reset_credits_json = NULL WHERE id = ?4",
                    params![info.access_token, info.refresh_token, new_expiry, id],
                );
            }
            bearer = Some(info.access_token);
            account_id = info.chatgpt_account_id;
            fedramp = false;
        }
    }

    let bearer = bearer.ok_or_else(|| "无可用认证信息".to_string())?;

    {
        let mut refreshing = state.refreshing.lock().map_err(|e| e.to_string())?;
        refreshing.insert(id.clone());
    }

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
        persist_account_usage(&db, &id, &bearer, &usage)
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

/// 启动时回填历史账号的 whoami 元数据（订阅类型、账号 ID、FedRAMP）。
/// 针对 `chatgpt_plan_type` 缺失的账号，用其 PAT 调 whoami 并更新。
fn backfill_account_metadata(state: &AppState) {
    let targets: Vec<(String, String)> = {
        let Ok(db) = state.db.lock() else {
            return;
        };
        let Ok(mut stmt) = db.prepare(
            "SELECT id, auth_json_content FROM accounts WHERE chatgpt_plan_type IS NULL",
        ) else {
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
        match exchange_rt_for_at(&rt) {
            Ok(info) => {
                let new_expiry =
                    DateTime::from_timestamp(info.at_expires_at, 0).map(|time| time.to_rfc3339());
                if let Ok(db) = state.db.lock() {
                    let _ = db.execute(
                        "UPDATE accounts SET access_token = ?1, refresh_token = ?2, at_expires_at = ?3, reset_credits_json = NULL WHERE id = ?4",
                        params![info.access_token, info.refresh_token, new_expiry, id],
                    );
                }
                eprintln!("[at-refresh] {id} 已刷新");
            }
            Err(error) => {
                eprintln!("[at-refresh] {id} 刷新失败: {error}");
            }
        }
    }
}

/// 后台额度调度器：重启后沿用持久化的 next_refresh_at 计划，仅刷新已到期的账号
/// （逐个、间隔 1 分钟），避免重启触发不必要的频繁刷新；同时管理 rt 账号的 at 自动刷新。
fn start_usage_scheduler(app: tauri::AppHandle) {
    thread::spawn(move || {
        // 启动时获取 Codex CLI 版本（供 User-Agent），并回填历史账号的 whoami 元数据。
        {
            let state = app.state::<AppState>();
            sync_codex_version(&*state);
            backfill_account_metadata(&*state);
        }

        loop {
            // 先刷新 at 临近过期的 rt 账号。
            {
                let state = app.state::<AppState>();
                refresh_due_access_tokens(&*state);
            }

            let due: Vec<(String, String, Option<String>, Option<String>, Option<String>, bool, Option<String>)> = {
                let state = app.state::<AppState>();
                let Ok(db) = state.db.lock() else {
                    thread::sleep(Duration::from_secs(30));
                    continue;
                };
                let now = Utc::now().to_rfc3339();
                let Ok(mut stmt) = db.prepare(
                    "SELECT id, auth_json_content, access_token, refresh_token, chatgpt_account_id, chatgpt_account_is_fedramp, at_expires_at FROM accounts WHERE next_refresh_at IS NULL OR next_refresh_at <= ?1 ORDER BY created_at ASC",
                ) else {
                    thread::sleep(Duration::from_secs(30));
                    continue;
                };
                let Ok(rows) = stmt.query_map(params![now], |row| Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, i32>(5)? == 1,
                    row.get::<_, Option<String>>(6)?,
                ))) else {
                    thread::sleep(Duration::from_secs(30));
                    continue;
                };
                rows.flatten().collect()
            };

            for (id, auth_json_content, access_token, refresh_token, chatgpt_account_id, fedramp, at_expires_at) in due {
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

                // 账号类型感知：rt 账号用 at（临近过期先刷新），PAT 账号用 PAT + whoami。
                let (mut bearer, mut account_id, fedramp, needs_whoami) = account_usage_context(
                    &auth_json_content,
                    access_token.as_deref(),
                    refresh_token.as_deref(),
                    chatgpt_account_id.as_deref(),
                    fedramp,
                );
                if refresh_token.is_some() && at_is_due(&at_expires_at) {
                    if let Some(rt) = refresh_token {
                        match exchange_rt_for_at(&rt) {
                            Ok(info) => {
                                let new_expiry = DateTime::from_timestamp(info.at_expires_at, 0)
                                    .map(|time| time.to_rfc3339());
                                if let Ok(db) = state.db.lock() {
                                    let _ = db.execute(
                                        "UPDATE accounts SET access_token = ?1, refresh_token = ?2, at_expires_at = ?3, reset_credits_json = NULL WHERE id = ?4",
                                        params![info.access_token, info.refresh_token, new_expiry, id],
                                    );
                                }
                                bearer = Some(info.access_token);
                                account_id = info.chatgpt_account_id;
                            }
                            Err(error) => {
                                eprintln!("[usage-scheduler] {id} at 刷新失败: {error}");
                            }
                        }
                    }
                }

                let Some(bearer) = bearer else {
                    eprintln!("[usage-scheduler] {id} 无可用认证，跳过");
                    let _ = app.emit(
                        "usage-refresh-finished",
                        AccountRefreshEvent { account_id: id.clone() },
                    );
                    continue;
                };

                let result = fetch_account_usage(&bearer, account_id.as_deref(), fedramp, needs_whoami);

                match result {
                    Ok(usage) => {
                        let ok = {
                            let state = app.state::<AppState>();
                            let persisted = match state.db.lock() {
                                Ok(db) => persist_account_usage(&db, &id, &bearer, &usage).is_ok(),
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

#[derive(Debug, Clone, Serialize)]
pub struct TestMessageResult {
    pub model: String,
    pub input: String,
    pub output: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TestOutputDelta {
    #[serde(rename = "accountId")]
    pub account_id: String,
    pub delta: String,
}

/// 从 Responses API 响应中提取助手输出文本。
fn extract_responses_output(response: &Value) -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Some(output) = response.get("output").and_then(|value| value.as_array()) {
        for item in output {
            if let Some(content) = item.get("content").and_then(|value| value.as_array()) {
                for part in content {
                    if let Some(text) = part.get("text").and_then(|value| value.as_str()) {
                        let trimmed = text.trim();
                        if !trimmed.is_empty() {
                            parts.push(trimmed.to_string());
                        }
                    }
                }
            }
        }
    }
    if !parts.is_empty() {
        return parts.join("\n");
    }

    if let Some(text) = response.get("output_text").and_then(|value| value.as_str()) {
        return text.to_string();
    }

    if let Some(message) = response
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(|value| value.as_str())
    {
        return format!("接口错误：{message}");
    }

    "(空响应)".to_string()
}

/// 从 Codex /responses 响应体中提取助手输出文本。兼容两种形式：
/// - 非流式 JSON（错误响应或未启用流式时）；
/// - 流式 SSE（`stream: true`）：累积 `response.output_text.delta`，
///   并优先用 `response.completed` 中完整的 output（该后端流式时 completed 的 output 可能为空）。
fn extract_responses_output_from_body(body: &str) -> String {
    if let Ok(response) = serde_json::from_str::<Value>(body) {
        let output = extract_responses_output(&response);
        if output != "(空响应)" && output != "接口错误：" {
            return output;
        }
    }

    // SSE 解析
    let mut deltas: Vec<String> = Vec::new();
    let mut done_text: Option<String> = None;
    let mut completed_response: Option<Value> = None;
    for line in body.lines() {
        let Some(data) = line.trim().strip_prefix("data:") else {
            continue;
        };
        let Ok(event) = serde_json::from_str::<Value>(data.trim()) else {
            continue;
        };
        match event.get("type").and_then(|value| value.as_str()) {
            Some("response.output_text.delta") => {
                if let Some(delta) = event.get("delta").and_then(|value| value.as_str()) {
                    deltas.push(delta.to_string());
                }
            }
            Some("response.output_text.done") => {
                if done_text.is_none() {
                    if let Some(text) = event.get("text").and_then(|value| value.as_str()) {
                        done_text = Some(text.to_string());
                    }
                }
            }
            Some("response.completed") => {
                if let Some(response) = event.get("response") {
                    completed_response = Some(response.clone());
                }
            }
            _ => {}
        }
    }

    // 仅当 completed 的 output 非空时才采用（流式时可能为空，此时用 delta）。
    if let Some(response) = completed_response {
        let has_output = response
            .get("output")
            .and_then(|value| value.as_array())
            .map(|items| !items.is_empty())
            .unwrap_or(false);
        if has_output {
            let output = extract_responses_output(&response);
            if output != "(空响应)" && output != "接口错误：" {
                return output;
            }
        }
    }
    if !deltas.is_empty() {
        return deltas.join("");
    }
    if let Some(text) = done_text {
        return text;
    }

    let truncated: String = body.chars().take(500).collect();
    if !truncated.trim().is_empty() {
        let suffix = if body.chars().count() > 500 { "…" } else { "" };
        return format!("{truncated}{suffix}");
    }
    "(无返回内容)".to_string()
}

/// 用账号调用 Codex 模型接口（chatgpt.com 后端 /responses）发送 "hello"，验证账号额度可用性。
#[tauri::command]
async fn send_test_message(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    model: String,
) -> Result<TestMessageResult, String> {
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
            .ok_or_else(|| "仅 Personal Access Token 账号支持额度测试".to_string())?
    };

    // 按 Codex 后端要求：input 为带 type 的消息列表、store 必须为 false、streaming 必须为 true。
    let request_body = serde_json::json!({
        "model": model,
        "input": [
            {
                "type": "message",
                "role": "user",
                "content": [
                    { "type": "input_text", "text": TEST_MESSAGE_CONTENT }
                ]
            }
        ],
        "stream": true,
        "store": false,
    })
    .to_string();

    let output = tauri::async_runtime::spawn_blocking(move || {
        let metadata = curl_get_json::<PersonalAccessTokenMetadata>(
            PERSONAL_ACCESS_TOKEN_METADATA_URL,
            &token,
            None,
            false,
        )
        .map_err(|error| format!("Token 校验失败：{error}"))?;
        curl_post_stream(
            &app,
            CODEX_RESPONSES_URL,
            &token,
            &metadata.chatgpt_account_id,
            &id,
            metadata.chatgpt_account_is_fedramp,
            &request_body,
        )
    })
    .await
    .map_err(|e| format!("测试任务失败：{e}"))??;

    Ok(TestMessageResult {
        model,
        input: TEST_MESSAGE_CONTENT.to_string(),
        output,
    })
}

#[tauri::command]
fn get_accounts(state: State<'_, AppState>) -> Result<AccountStore, String> {
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
                reset_credits: row.get::<_, Option<String>>(14)?.and_then(|json| serde_json::from_str(&json).ok()),
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

#[derive(Debug, Clone, Serialize)]
pub struct TokenInfo {
    pub email: String,
    #[serde(rename = "chatgptPlanType")]
    pub chatgpt_plan_type: String,
}

fn build_auth_json(token: &str) -> String {
    serde_json::json!({
        "OPENAI_API_KEY": null,
        "personal_access_token": token,
    })
    .to_string()
}

/// rt 兑换后的账号信息与令牌（供前端确认与保存）。
#[derive(Debug, Clone, Serialize)]
pub struct RtTokenInfo {
    pub email: String,
    #[serde(rename = "chatgptPlanType")]
    pub chatgpt_plan_type: Option<String>,
    #[serde(rename = "chatgptAccountId")]
    pub chatgpt_account_id: Option<String>,
    #[serde(rename = "accessToken")]
    pub access_token: String,
    #[serde(rename = "refreshToken")]
    pub refresh_token: String,
    #[serde(rename = "atExpiresAt")]
    pub at_expires_at: i64,
}

#[derive(Debug, Deserialize)]
struct OAuthTokenResponse {
    access_token: String,
    refresh_token: String,
}

/// 在任意层级的 JSON 中递归查找 `refresh_token` 字符串字段。
fn find_refresh_token(value: &Value) -> Option<&str> {
    match value {
        Value::Object(map) => {
            if let Some(Value::String(rt)) = map.get("refresh_token") {
                return Some(rt);
            }
            map.values().find_map(find_refresh_token)
        }
        Value::Array(items) => items.iter().find_map(find_refresh_token),
        _ => None,
    }
}

/// 从用户输入中提取 Refresh Token：输入为 JSON 时递归查找 `refresh_token` 字段（任意层级），否则视为原始 rt。
fn extract_refresh_token(input: &str) -> Result<String, String> {
    let input = input.trim();
    if input.is_empty() {
        return Err("请输入 Refresh Token".to_string());
    }
    if input.starts_with('{') {
        let json: Value = serde_json::from_str(input).map_err(|_| "JSON 解析失败".to_string())?;
        if let Some(rt) = find_refresh_token(&json) {
            let rt = rt.trim();
            if rt.is_empty() {
                return Err("JSON 中 refresh_token 为空".to_string());
            }
            return Ok(rt.to_string());
        }
        return Err("JSON 中未找到 refresh_token 字段".to_string());
    }
    Ok(input.to_string())
}

/// 解码 access_token（JWT）payload，提取邮箱/订阅/账号 ID/FedRAMP 与过期时间 exp。
/// 返回 (TokenMetadata, exp)。
fn decode_access_token(at: &str) -> Option<(TokenMetadata, i64)> {
    let payload = at.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload).ok()?;
    let value: Value = serde_json::from_slice(&bytes).ok()?;

    let profile = value.get("https://api.openai.com/profile");
    let email = value
        .get("email")
        .and_then(|v| v.as_str())
        .or_else(|| profile.and_then(|p| p.get("email")).and_then(|v| v.as_str()))
        .map(str::trim)
        .filter(|e| !e.is_empty())
        .map(str::to_string);

    let auth = value.get("https://api.openai.com/auth");
    let plan = auth
        .and_then(|a| a.get("chatgpt_plan_type"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .map(str::to_string);
    let user_id = auth
        .and_then(|a| a.get("chatgpt_user_id"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|u| !u.is_empty())
        .map(str::to_string);
    let account_id = auth
        .and_then(|a| a.get("chatgpt_account_id"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|a| !a.is_empty())
        .map(str::to_string)
        // 部分 token 无 chatgpt_account_id，回退用 user_id / poid。
        .or_else(|| {
            auth.and_then(|a| a.get("user_id"))
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|a| !a.is_empty())
                .map(str::to_string)
        })
        .or_else(|| {
            auth.and_then(|a| a.get("poid"))
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|a| !a.is_empty())
                .map(str::to_string)
        });
    let is_fedramp = auth
        .and_then(|a| a.get("chatgpt_account_is_fedramp"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let exp = value.get("exp").and_then(|v| v.as_i64())?;

    // 账号名优先邮箱，缺失时用 user_id。
    let email = email.or(user_id).unwrap_or_default();
    if email.is_empty() {
        return None;
    }

    Some((
        TokenMetadata {
            email,
            chatgpt_plan_type: plan,
            chatgpt_account_id: account_id,
            chatgpt_account_is_fedramp: is_fedramp,
        },
        exp,
    ))
}

/// 对表单值做 URL 编码（OAuth2 token 端点需要）。
fn urlencode(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// 用 rt 兑换 access_token（at）+ 新的 rt（rt 一次性使用），并解码 at 获取账号信息。
fn exchange_rt_for_at(rt: &str) -> Result<RtTokenInfo, String> {
    // 标准 OAuth2 token 端点使用表单格式；需带 Codex 的 client_id；rt 可能含特殊字符需 URL 编码。
    let body = format!(
        "grant_type=refresh_token&refresh_token={}&client_id={}",
        urlencode(rt),
        OAUTH_CLIENT_ID
    );

    let mut config = String::from(
        "silent\nshow-error\nrequest = \"POST\"\nconnect-timeout = 10\nmax-time = 25\nproto = \"=https\"\n",
    );
    config.push_str("url = ");
    config.push_str(&curl_config_quote(OAUTH_TOKEN_URL));
    config.push('\n');
    append_curl_header(&mut config, "Accept", "application/json")?;
    append_curl_header(&mut config, "Content-Type", "application/x-www-form-urlencoded")?;
    append_curl_header(&mut config, "User-Agent", &codex_cli_user_agent())?;
    config.push_str("data-raw = ");
    config.push_str(&curl_config_quote(&body));
    config.push('\n');
    config.push_str("write-out = \"\\n%{http_code}\"\n");

    let (response_body, status) = run_curl(&config)?;
    if !(200..300).contains(&status) {
        let detail: String = response_body.chars().take(300).collect();
        return Err(format!("兑换 Access Token 失败（HTTP {status}）：{detail}"));
    }

    let response: OAuthTokenResponse = serde_json::from_str(&response_body)
        .map_err(|_| "兑换接口返回的数据格式异常".to_string())?;

    let (meta, exp) = decode_access_token(&response.access_token)
        .ok_or_else(|| "无法从 Access Token 解析账号信息".to_string())?;

    Ok(RtTokenInfo {
        email: meta.email,
        chatgpt_plan_type: meta.chatgpt_plan_type,
        chatgpt_account_id: meta.chatgpt_account_id,
        access_token: response.access_token,
        refresh_token: response.refresh_token,
        at_expires_at: exp,
    })
}

/// 通过 whoami 解析 token 对应的邮箱、订阅类型、账号 ID 与 FedRAMP 标记。
struct TokenMetadata {
    email: String,
    chatgpt_plan_type: Option<String>,
    chatgpt_account_id: Option<String>,
    chatgpt_account_is_fedramp: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct OAuthLoginInfo {
    pub url: String,
    #[serde(rename = "redirectUri")]
    pub redirect_uri: String,
}

#[derive(Debug, Deserialize)]
struct OAuthCodeTokenResponse {
    id_token: String,
    access_token: String,
    refresh_token: String,
}

/// URL 解码（用于解析回调地址参数）。
fn urldecode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out: Vec<u8> = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = u8::from_str_radix(&value[i + 1..i + 3], 16) {
                out.push(hex);
                i += 3;
                continue;
            }
        }
        out.push(if bytes[i] == b'+' { b' ' } else { bytes[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// 生成 PKCE（code_verifier, code_challenge）。
fn generate_pkce() -> (String, String) {
    let mut bytes = [0u8; 64];
    rand::thread_rng().fill_bytes(&mut bytes);
    let verifier = URL_SAFE_NO_PAD.encode(bytes);
    let digest = Sha256::digest(verifier.as_bytes());
    let challenge = URL_SAFE_NO_PAD.encode(digest);
    (verifier, challenge)
}

fn generate_oauth_state() -> String {
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn build_oauth_authorize_url(
    client_id: &str,
    redirect_uri: &str,
    challenge: &str,
    state: &str,
) -> String {
    let query = [
        ("response_type", "code"),
        ("client_id", client_id),
        ("redirect_uri", redirect_uri),
        // 与 Codex CLI 完全一致的 scope。
        ("scope", "openid profile email offline_access api.connectors.read api.connectors.invoke"),
        ("code_challenge", challenge),
        ("code_challenge_method", "S256"),
        ("id_token_add_organizations", "true"),
        ("codex_cli_simplified_flow", "true"),
        ("state", state),
        ("originator", "codex_cli_rs"),
    ];
    let qs = query
        .iter()
        .map(|(key, value)| format!("{key}={}", urlencode(value)))
        .collect::<Vec<_>>()
        .join("&");
    format!("https://auth.openai.com/oauth/authorize?{qs}")
}

/// 读取一次 HTTP 请求的请求行与请求头（回调只需请求行）。
fn read_http_request(stream: &mut TcpStream) -> std::io::Result<String> {
    let mut reader = BufReader::new(stream);
    let mut request_line = String::new();
    reader.read_line(&mut request_line)?;
    // 消费剩余请求头（到空行为止）
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header)? == 0 || header.trim().is_empty() {
            break;
        }
    }
    Ok(request_line)
}

fn write_http_response(stream: &mut TcpStream, message: &str) -> std::io::Result<()> {
    let html = format!(
        "<html><body style=\"font-family:sans-serif;padding:40px;text-align:center\"><h2>Codex Portal 登录成功</h2><p>{message}</p><p>可以关闭此窗口返回应用。</p></body></html>"
    );
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        html.len(),
        html
    );
    stream.write_all(response.as_bytes())
}

/// 从请求行或回调 URL 中解析 `code` 与 `state`。
/// 请求行形如 `GET /auth/callback?code=..&state=.. HTTP/1.1`，query 末尾带 HTTP 版本需去掉。
fn parse_callback_query(url_or_path: &str) -> Option<(String, String)> {
    let query = url_or_path.split('?').nth(1)?.split_whitespace().next()?;
    let mut code = None;
    let mut state = None;
    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        let key = parts.next()?;
        let value = urldecode(parts.next().unwrap_or(""));
        match key {
            "code" => code = Some(value),
            "state" => state = Some(value),
            _ => {}
        }
    }
    Some((code?, state?))
}

/// 用授权码（authorization_code）兑换 id_token / access_token / refresh_token。
fn exchange_oauth_code(
    code: &str,
    redirect_uri: &str,
    code_verifier: &str,
) -> Result<RtTokenInfo, String> {
    let body = format!(
        "grant_type=authorization_code&code={}&redirect_uri={}&client_id={}&code_verifier={}",
        urlencode(code),
        urlencode(redirect_uri),
        OAUTH_CLIENT_ID,
        urlencode(code_verifier),
    );

    let mut config = String::from(
        "silent\nshow-error\nrequest = \"POST\"\nconnect-timeout = 10\nmax-time = 25\nproto = \"=https\"\n",
    );
    config.push_str("url = ");
    config.push_str(&curl_config_quote(OAUTH_TOKEN_URL));
    config.push('\n');
    append_curl_header(&mut config, "Accept", "application/json")?;
    append_curl_header(&mut config, "Content-Type", "application/x-www-form-urlencoded")?;
    append_curl_header(&mut config, "User-Agent", &codex_cli_user_agent())?;
    config.push_str("data-raw = ");
    config.push_str(&curl_config_quote(&body));
    config.push('\n');
    config.push_str("write-out = \"\\n%{http_code}\"\n");

    let (response_body, status) = run_curl(&config)?;
    if !(200..300).contains(&status) {
        let detail: String = response_body.chars().take(300).collect();
        return Err(format!("OAuth 兑换失败（HTTP {status}）：{detail}"));
    }

    let response: OAuthCodeTokenResponse = serde_json::from_str(&response_body)
        .map_err(|_| "OAuth 兑换接口返回的数据格式异常".to_string())?;

    let (at_meta, exp) = decode_access_token(&response.access_token)
        .ok_or_else(|| "无法从 Access Token 解析账号信息".to_string())?;
    // id_token 更可能带邮箱/订阅，优先使用。
    let id_meta = decode_access_token(&response.id_token);

    let email = id_meta
        .as_ref()
        .and_then(|(meta, _)| (!meta.email.is_empty()).then(|| meta.email.clone()))
        .unwrap_or(at_meta.email);
    let chatgpt_plan_type = id_meta
        .as_ref()
        .and_then(|(meta, _)| meta.chatgpt_plan_type.clone())
        .or(at_meta.chatgpt_plan_type);
    let chatgpt_account_id = id_meta
        .as_ref()
        .and_then(|(meta, _)| meta.chatgpt_account_id.clone())
        .or(at_meta.chatgpt_account_id);

    Ok(RtTokenInfo {
        email,
        chatgpt_plan_type,
        chatgpt_account_id,
        access_token: response.access_token,
        refresh_token: response.refresh_token,
        at_expires_at: exp,
    })
}

/// 启动一次 OAuth 登录：生成授权链接，并在本地启动一次回调监听（浏览器登录后回跳 localhost）。
/// 回调端口固定 1455（与 Codex CLI 一致），被占用时回退 1457，最后才用随机端口。
fn bind_oauth_listener() -> std::io::Result<TcpListener> {
    for port in [1455, 1457] {
        if let Ok(listener) = TcpListener::bind(("127.0.0.1", port)) {
            return Ok(listener);
        }
    }
    TcpListener::bind("127.0.0.1:0")
}

#[tauri::command]
async fn start_oauth_login(app: tauri::AppHandle) -> Result<OAuthLoginInfo, String> {
    let (verifier, challenge) = generate_pkce();
    let state = generate_oauth_state();

    let listener = bind_oauth_listener()
        .map_err(|e| format!("无法启动本地回调服务器：{e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();
    let redirect_uri = format!("http://localhost:{port}/auth/callback");

    {
        let app_state = app.state::<AppState>();
        let mut oauth = app_state.oauth.lock().map_err(|e| e.to_string())?;
        oauth.code_verifier = Some(verifier.clone());
        oauth.state = Some(state.clone());
        oauth.redirect_uri = Some(redirect_uri.clone());
        oauth.callback_code = None;
    }

    // 后台线程监听一次回调。
    let thread_app = app.clone();
    let expected_state = state.clone();
    thread::spawn(move || {
        if let Ok((mut stream, _addr)) = listener.accept() {
            let message = match read_http_request(&mut stream) {
                Ok(request_line) => match parse_callback_query(&request_line) {
                    Some((code, callback_state)) if callback_state == expected_state => {
                        let app_state = thread_app.state::<AppState>();
                        if let Ok(mut oauth) = app_state.oauth.lock() {
                            oauth.callback_code = Some(code);
                        }
                        "登录成功，可以关闭此窗口"
                    }
                    _ => "回调参数无效",
                },
                Err(_) => "回调请求读取失败",
            };
            let _ = write_http_response(&mut stream, message);
        }
    });

    let url = build_oauth_authorize_url(OAUTH_CLIENT_ID, &redirect_uri, &challenge, &state);
    Ok(OAuthLoginInfo { url, redirect_uri })
}

/// 检查本地是否已捕获回调；若已捕获则兑换 token 并返回账号信息。
#[tauri::command]
async fn check_oauth_callback(state: State<'_, AppState>) -> Result<Option<RtTokenInfo>, String> {
    let (code, verifier, redirect_uri) = {
        let oauth = state.oauth.lock().map_err(|e| e.to_string())?;
        (
            oauth.callback_code.clone(),
            oauth.code_verifier.clone(),
            oauth.redirect_uri.clone(),
        )
    };

    let Some(code) = code else {
        return Ok(None);
    };

    let info = tauri::async_runtime::spawn_blocking(move || {
        exchange_oauth_code(
            &code,
            &redirect_uri.unwrap_or_default(),
            &verifier.unwrap_or_default(),
        )
    })
    .await
    .map_err(|e| format!("OAuth 兑换任务失败：{e}"))??;

    clear_oauth_session(&state);
    Ok(Some(info))
}

/// 用户手动粘贴本地回调地址（在其它设备/浏览器登录后）完成认证。
#[tauri::command]
async fn complete_oauth_login(
    state: State<'_, AppState>,
    redirect_url: String,
) -> Result<RtTokenInfo, String> {
    let (code, callback_state) =
        parse_callback_query(&redirect_url).ok_or_else(|| "无法从回调地址解析 code".to_string())?;

    let (expected_state, verifier, redirect_uri) = {
        let oauth = state.oauth.lock().map_err(|e| e.to_string())?;
        (
            oauth.state.clone(),
            oauth.code_verifier.clone(),
            oauth.redirect_uri.clone(),
        )
    };
    if let Some(expected) = expected_state {
        if callback_state != expected {
            return Err("回调地址的 state 不匹配，请确认是本次登录生成的地址".to_string());
        }
    }

    let info = tauri::async_runtime::spawn_blocking(move || {
        exchange_oauth_code(&code, &redirect_uri.unwrap_or_default(), &verifier.unwrap_or_default())
    })
    .await
    .map_err(|e| format!("OAuth 兑换任务失败：{e}"))??;

    clear_oauth_session(&state);
    Ok(info)
}

fn clear_oauth_session(state: &AppState) {
    if let Ok(mut oauth) = state.oauth.lock() {
        oauth.code_verifier = None;
        oauth.state = None;
        oauth.redirect_uri = None;
        oauth.callback_code = None;
    }
}

fn resolve_token_metadata(token: &str) -> Result<TokenMetadata, String> {
    let metadata = curl_get_json::<PersonalAccessTokenMetadata>(
        PERSONAL_ACCESS_TOKEN_METADATA_URL,
        token,
        None,
        false,
    )
    .map_err(|error| format!("Token 校验失败：{error}"))?;

    let email = metadata.email.trim().to_string();
    if email.is_empty() {
        return Err("Token 校验失败：接口未返回邮箱信息".to_string());
    }
    let plan = metadata.chatgpt_plan_type.trim().to_string();
    let account_id = metadata.chatgpt_account_id.trim().to_string();
    Ok(TokenMetadata {
        email,
        chatgpt_plan_type: if plan.is_empty() { None } else { Some(plan) },
        chatgpt_account_id: if account_id.is_empty() { None } else { Some(account_id) },
        chatgpt_account_is_fedramp: metadata.chatgpt_account_is_fedramp,
    })
}

/// 校验 Personal Access Token 并返回账号信息（邮箱、订阅类型），供添加/编辑前确认展示。
#[tauri::command]
async fn validate_personal_token(token: String) -> Result<TokenInfo, String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("Token 不能为空".to_string());
    }

    let meta = tauri::async_runtime::spawn_blocking(move || resolve_token_metadata(&token))
        .await
        .map_err(|e| format!("Token 校验任务失败：{e}"))??;

    Ok(TokenInfo {
        email: meta.email,
        chatgpt_plan_type: meta.chatgpt_plan_type.unwrap_or_default(),
    })
}

/// 用 Refresh Token（rt）兑换 access_token（at）并解码账号信息。
/// 输入可为 JSON（自动提取 refresh_token）或原始 rt；rt 一次性使用，兑换后返回新的 rt。
#[tauri::command]
async fn exchange_refresh_token(input: String) -> Result<RtTokenInfo, String> {
    let rt = extract_refresh_token(&input)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut info = exchange_rt_for_at(&rt)?;
        // at 的 JWT 里可能没有订阅类型，尽力从额度接口（只读）补全。
        if let Ok(usage) = fetch_account_usage(
            &info.access_token,
            info.chatgpt_account_id.as_deref(),
            false,
            false,
        ) {
            if let Some(plan) = usage.plan_type {
                info.chatgpt_plan_type = Some(plan);
            }
        }
        Ok::<RtTokenInfo, String>(info)
    })
    .await
    .map_err(|e| format!("兑换任务失败：{e}"))?
}

/// 保存通过 rt 兑换的账号（at + 新 rt + at 过期时间）。
#[tauri::command]
async fn save_rt_account(
    state: State<'_, AppState>,
    email: String,
    chatgpt_plan_type: Option<String>,
    chatgpt_account_id: Option<String>,
    access_token: String,
    refresh_token: String,
    at_expires_at: i64,
    notes: Option<String>,
) -> Result<Account, String> {
    let access_token = access_token.trim().to_string();
    let refresh_token = refresh_token.trim().to_string();
    if access_token.is_empty() || refresh_token.is_empty() {
        return Err("Token 信息不完整，请重新兑换".to_string());
    }

    let auth_json_content = serde_json::json!({ "personal_access_token": null }).to_string();
    let now = Utc::now().to_rfc3339();
    let at_expires = DateTime::from_timestamp(at_expires_at, 0)
        .map(|time| time.to_rfc3339())
        .unwrap_or_else(|| now.clone());

    let account = Account {
        id: Uuid::new_v4().to_string(),
        name: email,
        auth_json_content,
        notes,
        created_at: now.clone(),
        updated_at: now,
        // 限额类型由额度接口自动推导。
        plan_type: "weekly".to_string(),
        usage: None,
        can_refresh_usage: true,
        next_refresh_at: None,
        chatgpt_plan_type,
        has_access_token: true,
        reset_credits: None,
        is_active: false,
        access_token: Some(access_token),
        chatgpt_account_id,
        chatgpt_account_is_fedramp: false,
        refresh_token: Some(refresh_token),
        at_expires_at: Some(at_expires),
    };

    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let count: i32 = db
        .query_row("SELECT COUNT(*) FROM accounts", [], |row| row.get(0))
        .unwrap_or(0);
    let mut account_to_return = account.clone();
    account_to_return.is_active = count == 0;

    let tx = db.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO accounts (id, name, auth_json_content, notes, created_at, updated_at, is_active, plan_type, chatgpt_plan_type, chatgpt_account_id, chatgpt_account_is_fedramp, access_token, refresh_token, at_expires_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
        params![account.id, account.name, account.auth_json_content, account.notes, account.created_at, account.updated_at, if count == 0 { 1 } else { 0 }, account.plan_type, account.chatgpt_plan_type, account.chatgpt_account_id, account.chatgpt_account_is_fedramp as i32, account.access_token, account.refresh_token, account.at_expires_at],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;

    // rt 账号无法生成 codex 可用的 auth.json，不写入 ~/.codex/auth.json。
    Ok(account_to_return)
}

#[tauri::command]
async fn add_account(
    state: State<'_, AppState>,
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
        .query_row("SELECT COUNT(*) FROM accounts", [], |row| row.get(0))
        .unwrap_or(0);
    let mut account_to_return = account.clone();
    account_to_return.is_active = count == 0;

    let tx = db.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO accounts (id, name, auth_json_content, notes, created_at, updated_at, is_active, plan_type, chatgpt_plan_type, chatgpt_account_id, chatgpt_account_is_fedramp) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![account.id, account.name, account.auth_json_content, account.notes, account.created_at, account.updated_at, if count == 0 { 1 } else { 0 }, account.plan_type, account.chatgpt_plan_type, account.chatgpt_account_id, account.chatgpt_account_is_fedramp as i32],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;

    if count == 0 {
        apply_auth_json_if_pat(&account.auth_json_content);
    }

    Ok(account_to_return)
}

#[tauri::command]
async fn update_account(
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

    let token_changed =
        extract_personal_access_token(&existing_auth_json_content).as_deref() != Some(token.as_str());

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
fn set_account_access_token(
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

/// 获取账号的重置卡信息：优先返回已保存的；未保存则自动请求并保存。`force` 为 true 时强制重新请求。
#[tauri::command]
async fn get_reset_credits(
    state: State<'_, AppState>,
    id: String,
    force: Option<bool>,
) -> Result<ResetCreditsInfo, String> {
    let (at, account_id, is_fedramp, saved) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.query_row(
            "SELECT access_token, chatgpt_account_id, chatgpt_account_is_fedramp, reset_credits_json FROM accounts WHERE id = ?1",
            params![id],
            |row| Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, i32>(2)? == 1,
                row.get::<_, Option<String>>(3)?,
            )),
        )
        .map_err(|_| "Account not found".to_string())?
    };
    let at = at.ok_or_else(|| "未配置 Access Token".to_string())?;

    if !force.unwrap_or(false) {
        if let Some(json) = saved {
            if let Ok(info) = serde_json::from_str::<ResetCreditsInfo>(&json) {
                return Ok(info);
            }
        }
    }

    let info = tauri::async_runtime::spawn_blocking(move || {
        fetch_reset_credits(&at, account_id.as_deref(), is_fedramp)
    })
    .await
    .map_err(|e| format!("获取重置卡任务失败：{e}"))??;

    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let json = serde_json::to_string(&info).map_err(|e| e.to_string())?;
        db.execute(
            "UPDATE accounts SET reset_credits_json = ?1 WHERE id = ?2",
            params![json, id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(info)
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
                apply_auth_json_if_pat(&content);
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

    apply_auth_json_if_pat(&content);
    Ok(())
}

/// 仅当认证内容含 Personal Access Token（codex 可用的认证格式）时才写入 ~/.codex/auth.json。
/// rt 账号（无 PAT）不会覆盖本地 auth.json。
fn apply_auth_json_if_pat(content: &str) {
    if extract_personal_access_token(content).is_some() {
        let _ = apply_auth_json(content);
    }
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

/// 读取本机 Codex CLI 版本号（失败返回 None）。
/// `codex --version` 输出形如 "codex-cli 0.147.0"，这里只提取版本号。
fn local_codex_version() -> Option<String> {
    let output = codex_command().arg("--version").output().ok()?;
    if output.status.success() {
        let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if raw.is_empty() {
            None
        } else {
            Some(
                raw.split_whitespace()
                    .last()
                    .map(str::to_string)
                    .unwrap_or(raw),
            )
        }
    } else {
        None
    }
}

fn get_config_value(db: &Connection, key: &str) -> Option<String> {
    db.query_row(
        "SELECT content FROM configs WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .ok()
}

fn set_config_value(db: &Connection, key: &str, value: &str) {
    let _ = db.execute(
        "INSERT INTO configs (key, content) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET content = ?2",
        params![key, value],
    );
}

/// 启动时获取 Codex CLI 版本号并缓存/入库，供 User-Agent 使用。
/// 优先用本机 `codex --version`，失败则回退到已保存的值。
fn sync_codex_version(state: &AppState) {
    let version = local_codex_version().or_else(|| {
        let db = state.db.lock().ok()?;
        get_config_value(&db, "codex_version")
    });

    if let Some(version) = version {
        let trimmed = version.trim().to_string();
        if trimmed.is_empty() {
            return;
        }
        let _ = CODEX_VERSION.set(trimmed.clone());
        if let Ok(db) = state.db.lock() {
            set_config_value(&db, "codex_version", &trimmed);
        }
    }
}

/// 返回 Codex CLI 版本号：从数据库读取（启动时自动获取并保存），不实时执行。
#[tauri::command]
fn get_codex_version(state: State<'_, AppState>) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    match get_config_value(&db, "codex_version") {
        Some(version) if !version.trim().is_empty() => Ok(version.trim().to_string()),
        _ => Err("尚未获取到 Codex 版本（应用启动时会自动检测）".to_string()),
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
                oauth: Mutex::new(OAuthSession::default()),
            });

            start_usage_scheduler(app.handle().clone());

            #[cfg(desktop)]
            show_main_window(app.handle());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_accounts,
            validate_personal_token,
            exchange_refresh_token,
            save_rt_account,
            start_oauth_login,
            check_oauth_callback,
            complete_oauth_login,
            add_account,
            update_account,
            delete_account,
            set_active_account,
            set_account_access_token,
            get_reset_credits,
            refresh_account_usage,
            send_test_message,
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
            plan_type: None,
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
            plan_type: None,
        };
        let next = compute_next_refresh_at(&usage, now);
        assert_eq!(next, utc_ts("2026-08-07T11:00:00Z"));
    }

    #[test]
    fn derive_plan_weekly() {
        let usage = AccountUsage {
            primary: Some(AccountUsageWindow {
                used_percent: 30.0,
                window_minutes: Some(300),
                resets_at: None,
            }),
            secondary: Some(AccountUsageWindow {
                used_percent: 50.0,
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
            primary: None,
            secondary: Some(AccountUsageWindow {
                used_percent: 50.0,
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
            primary: None,
            secondary: Some(AccountUsageWindow {
                used_percent: 50.0,
                window_minutes: Some(300),
                resets_at: None,
            }),
            synced_at: "2026-08-07T10:00:00Z".to_string(),
            plan_type: None,
        };
        assert_eq!(derive_plan_type_from_usage(&usage), None);
    }

    #[test]
    fn extract_rt_from_json() {
        let input = r#"{"access_token":"x","refresh_token":"rt-abc"}"#;
        assert_eq!(extract_refresh_token(input).unwrap(), "rt-abc");
    }

    #[test]
    fn extract_rt_from_raw() {
        assert_eq!(extract_refresh_token("rt-raw-token").unwrap(), "rt-raw-token");
    }

    #[test]
    fn extract_rt_json_missing_field_errors() {
        let input = r#"{"access_token":"x"}"#;
        assert!(extract_refresh_token(input).is_err());
    }

    #[test]
    fn extract_rt_from_nested_json() {
        let input = r#"{"tokens":{"session":{"refresh_token":"rt-nested"}}}"#;
        assert_eq!(extract_refresh_token(input).unwrap(), "rt-nested");
    }

    #[test]
    fn parse_callback_query_strips_http_version() {
        let line = "GET /auth/callback?code=abc123&state=xyz789 HTTP/1.1";
        let (code, state) = parse_callback_query(line).unwrap();
        assert_eq!(code, "abc123");
        assert_eq!(state, "xyz789");
    }

    #[test]
    fn parse_callback_query_full_url() {
        let url = "http://localhost:1455/auth/callback?code=abc123&state=xyz789";
        let (code, state) = parse_callback_query(url).unwrap();
        assert_eq!(code, "abc123");
        assert_eq!(state, "xyz789");
    }

    #[test]
    fn decode_access_token_jwt() {
        let payload = serde_json::json!({
            "email": "user@example.com",
            "exp": 1_800_000_000_i64,
            "https://api.openai.com/auth": {
                "chatgpt_plan_type": "team",
                "chatgpt_account_id": "acc_123",
                "chatgpt_user_id": "user_456"
            }
        })
        .to_string();
        let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"none"}"#);
        let body = URL_SAFE_NO_PAD.encode(payload.as_bytes());
        let token = format!("{header}.{body}.sig");

        let (meta, exp) = decode_access_token(&token).unwrap();
        assert_eq!(meta.email, "user@example.com");
        assert_eq!(meta.chatgpt_plan_type.as_deref(), Some("team"));
        assert_eq!(meta.chatgpt_account_id.as_deref(), Some("acc_123"));
        assert_eq!(exp, 1_800_000_000);
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
            primary: Some(AccountUsageWindow {
                used_percent: 100.0,
                window_minutes: Some(300),
                resets_at: Some(resets_at),
            }),
            secondary: None,
            synced_at: now.to_rfc3339(),
            plan_type: None,
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
