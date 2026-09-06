use crate::codex::version::codex_cli_user_agent;
use crate::http::{append_curl_header, curl_config_quote, run_curl};
use crate::state::AppState;
use chrono::DateTime;
use chrono::Utc;
use rusqlite::params;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;
use tauri::State;
use uuid::Uuid;

const RESET_CREDITS_URL: &str = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";

const RESET_CREDITS_CONSUME_URL: &str =
    "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct ResetCredit {
    pub(crate) id: Option<String>,
    pub(crate) status: Option<String>,
    #[serde(rename = "resetType")]
    pub(crate) reset_type: Option<String>,
    #[serde(rename = "expiresAt")]
    pub(crate) expires_at: Option<i64>,
    #[serde(rename = "grantedAt")]
    pub(crate) granted_at: Option<i64>,
    #[serde(rename = "redeemedAt")]
    pub(crate) redeemed_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct ResetCreditsInfo {
    #[serde(rename = "availableCount")]
    pub(crate) available_count: i64,
    pub(crate) credits: Vec<ResetCredit>,
    #[serde(rename = "syncedAt")]
    pub(crate) synced_at: String,
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
    append_curl_header(&mut config, "User-Agent", &codex_cli_user_agent())?;
    if let Some(account_id) = account_id {
        append_curl_header(&mut config, "ChatGPT-Account-Id", account_id)?;
    }
    if is_fedramp {
        append_curl_header(&mut config, "X-OpenAI-Fedramp", "true")?;
    }
    config.push_str("write-out = \"\\n%{http_code}\"\n");

    let (body, status) = run_curl(&config)?;
    if !(200..300).contains(&status) {
        return Err(match status {
            401 | 403 => "Access Token 已失效或无权访问，请重新输入 Access Token".to_string(),
            429 => "获取重置卡失败：请求过于频繁，请稍后再试".to_string(),
            _ => format!("获取重置卡失败（HTTP {status}）"),
        });
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

/// 获取账号的重置卡信息：优先返回已保存的；未保存则自动请求并保存。`force` 为 true 时强制重新请求。
#[tauri::command]
pub(crate) async fn get_reset_credits(
    state: State<'_, AppState>,
    id: String,
    force: Option<bool>,
) -> Result<ResetCreditsInfo, String> {
    load_reset_credits_cached(&state, id, force.unwrap_or(false)).await
}

/// 读取（或强制刷新）账号的重置卡信息并缓存入库，供查询与"使用重置卡"后刷新复用。
async fn load_reset_credits_cached(
    state: &State<'_, AppState>,
    id: String,
    force: bool,
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

    if !force {
        if let Some(json) = saved {
            if let Ok(info) = serde_json::from_str::<ResetCreditsInfo>(&json) {
                return Ok(info);
            }
        }
    }

    let info = tauri::async_runtime::spawn_blocking({
        let at = at.clone();
        let account_id = account_id.clone();
        move || fetch_reset_credits(&at, account_id.as_deref(), is_fedramp)
    })
    .await
    .map_err(|e| format!("获取重置卡任务失败：{e}"))??;

    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let json = serde_json::to_string(&info).map_err(|e| e.to_string())?;
        // 请求期间更换 PAT/AT 后，旧请求不得重新写入已清除的缓存。
        let changed = db
            .execute(
                "UPDATE accounts SET reset_credits_json = ?1
                 WHERE id = ?2 AND access_token = ?3
                   AND chatgpt_account_id IS ?4 AND chatgpt_account_is_fedramp = ?5",
                params![json, id, at, account_id, is_fedramp as i32],
            )
            .map_err(|e| e.to_string())?;
        if changed != 1 {
            return Err("账号认证已变更，请重新操作。".to_string());
        }
    }

    Ok(info)
}

/// 构造"使用重置卡"请求失败的友好错误信息。
fn build_consume_error(status: u16, body: &str) -> String {
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
        return format!("使用重置卡失败（HTTP {status}）：{message}");
    }

    let generic = match status {
        401 | 403 => "Access Token 已失效或无权访问，请重新输入 Access Token".to_string(),
        429 => "请求过于频繁，请稍后再试".to_string(),
        _ => String::new(),
    };
    if !generic.is_empty() {
        return format!("使用重置卡失败（HTTP {status}）：{generic}");
    }
    format!("使用重置卡失败（HTTP {status}）")
}

/// 使用一张重置卡请求重置额度（consume）。
/// 成功后刷新并缓存最新的重置卡列表返回。
#[tauri::command]
pub(crate) async fn consume_reset_credit(
    state: State<'_, AppState>,
    id: String,
    credit_id: String,
) -> Result<ResetCreditsInfo, String> {
    let credit_id = credit_id.trim().to_string();
    if credit_id.is_empty() {
        return Err("请选择要使用的重置卡".to_string());
    }

    let (at, account_id, is_fedramp) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.query_row(
            "SELECT access_token, chatgpt_account_id, chatgpt_account_is_fedramp FROM accounts WHERE id = ?1",
            params![id],
            |row| Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, i32>(2)? == 1,
            )),
        )
        .map_err(|_| "Account not found".to_string())?
    };
    let at = at.ok_or_else(|| "未配置 Access Token".to_string())?;
    let redeem_request_id = Uuid::new_v4().to_string();

    tauri::async_runtime::spawn_blocking(move || {
        let body = serde_json::json!({
            "credit_id": credit_id,
            "redeem_request_id": redeem_request_id,
        })
        .to_string();

        let mut config = String::from(
            "silent\nshow-error\nrequest = \"POST\"\nconnect-timeout = 10\nmax-time = 25\nproto = \"=https\"\n",
        );
        config.push_str("url = ");
        config.push_str(&curl_config_quote(RESET_CREDITS_CONSUME_URL));
        config.push('\n');
        append_curl_header(&mut config, "Accept", "application/json")?;
        append_curl_header(&mut config, "Content-Type", "application/json")?;
        append_curl_header(&mut config, "Authorization", &format!("Bearer {at}"))?;
        append_curl_header(&mut config, "originator", "Codex Desktop")?;
        append_curl_header(&mut config, "OAI-Product-Sku", "CODEX")?;
        append_curl_header(&mut config, "User-Agent", &codex_cli_user_agent())?;
        if let Some(account_id) = account_id {
            append_curl_header(&mut config, "ChatGPT-Account-Id", &account_id)?;
        }
        if is_fedramp {
            append_curl_header(&mut config, "X-OpenAI-Fedramp", "true")?;
        }
        config.push_str("data-raw = ");
        config.push_str(&curl_config_quote(&body));
        config.push('\n');
        config.push_str("write-out = \"\\n%{http_code}\"\n");

        let (response_body, status) = run_curl(&config)?;
        if !(200..300).contains(&status) {
            return Err(build_consume_error(status, &response_body));
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("使用重置卡任务失败：{e}"))??;

    // 使用成功后强制刷新卡片列表（状态会变为已兑换/可用数减少）并返回。
    load_reset_credits_cached(&state, id, true).await
}
