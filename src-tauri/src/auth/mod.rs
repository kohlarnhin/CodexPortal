pub(crate) mod oauth;

use crate::accounts::usage::fetch_account_usage;
use crate::codex::version::codex_cli_user_agent;
use crate::http::{append_curl_header, curl_config_quote, curl_get_json, run_curl};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;
use std::fs;

pub(crate) const PERSONAL_ACCESS_TOKEN_METADATA_URL: &str =
    "https://auth.openai.com/api/accounts/v1/user-auth-credential/whoami";

pub(crate) const OAUTH_TOKEN_URL: &str = "https://auth.openai.com/oauth/token";

/// Codex CLI 登录使用的 OAuth client_id（/oauth/token 必需）。
pub(crate) const OAUTH_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";

#[derive(Debug, Deserialize)]
pub(crate) struct PersonalAccessTokenMetadata {
    pub(crate) chatgpt_account_id: String,
    #[serde(default)]
    pub(crate) chatgpt_account_is_fedramp: bool,
    #[serde(default)]
    pub(crate) chatgpt_plan_type: String,
    #[serde(default)]
    pub(crate) email: String,
}

pub(crate) fn extract_personal_access_token(auth_json_content: &str) -> Option<String> {
    let auth_json = serde_json::from_str::<Value>(auth_json_content).ok()?;
    auth_json
        .get("personal_access_token")?
        .as_str()
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(str::to_string)
}

/// auth.json 中可自动导入的凭证类型。
#[derive(Debug)]
pub(crate) enum AuthJsonCredential {
    /// Personal Access Token（personal_access_token 字段）。
    Pat(String),
    /// Refresh Token（任意层级嵌套的 refresh_token 字段）。
    RefreshToken(String),
}

/// 从 auth.json 内容中解析支持的凭证：与"添加账号"支持的格式一致——
/// 优先 personal_access_token（PAT），其次任意层级 refresh_token（rt）；
/// 两者都不支持则返回 None。
pub(crate) fn resolve_auth_json_credential(content: &str) -> Option<AuthJsonCredential> {
    if let Some(pat) = extract_personal_access_token(content) {
        return Some(AuthJsonCredential::Pat(pat));
    }
    let value = serde_json::from_str::<Value>(content).ok()?;
    find_refresh_token(&value).map(|rt| AuthJsonCredential::RefreshToken(rt.to_string()))
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct TokenInfo {
    pub(crate) email: String,
    #[serde(rename = "chatgptPlanType")]
    pub(crate) chatgpt_plan_type: String,
}

pub(crate) fn build_auth_json(token: &str) -> String {
    serde_json::json!({
        "OPENAI_API_KEY": null,
        "personal_access_token": token,
    })
    .to_string()
}

/// rt 兑换后的账号信息与令牌（供前端确认与保存）。
#[derive(Debug, Clone, Serialize)]
pub(crate) struct RtTokenInfo {
    pub(crate) email: String,
    #[serde(rename = "chatgptPlanType")]
    pub(crate) chatgpt_plan_type: Option<String>,
    #[serde(rename = "chatgptAccountId")]
    pub(crate) chatgpt_account_id: Option<String>,
    #[serde(rename = "accessToken")]
    pub(crate) access_token: String,
    #[serde(rename = "refreshToken")]
    pub(crate) refresh_token: String,
    #[serde(rename = "atExpiresAt")]
    pub(crate) at_expires_at: i64,
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
pub(crate) fn decode_access_token(at: &str) -> Option<(TokenMetadata, i64)> {
    let payload = at.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload).ok()?;
    let value: Value = serde_json::from_slice(&bytes).ok()?;

    let profile = value.get("https://api.openai.com/profile");
    let email = value
        .get("email")
        .and_then(|v| v.as_str())
        .or_else(|| {
            profile
                .and_then(|p| p.get("email"))
                .and_then(|v| v.as_str())
        })
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
pub(crate) fn urlencode(value: &str) -> String {
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
pub(crate) fn exchange_rt_for_at(rt: &str) -> Result<RtTokenInfo, String> {
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
    append_curl_header(
        &mut config,
        "Content-Type",
        "application/x-www-form-urlencoded",
    )?;
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
pub(crate) struct TokenMetadata {
    pub(crate) email: String,
    pub(crate) chatgpt_plan_type: Option<String>,
    pub(crate) chatgpt_account_id: Option<String>,
    pub(crate) chatgpt_account_is_fedramp: bool,
}

pub(crate) fn resolve_token_metadata(token: &str) -> Result<TokenMetadata, String> {
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
        chatgpt_account_id: if account_id.is_empty() {
            None
        } else {
            Some(account_id)
        },
        chatgpt_account_is_fedramp: metadata.chatgpt_account_is_fedramp,
    })
}

/// 校验 Personal Access Token 并返回账号信息（邮箱、订阅类型），供添加/编辑前确认展示。
#[tauri::command]
pub(crate) async fn validate_personal_token(token: String) -> Result<TokenInfo, String> {
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

/// at 的 JWT 里可能没有订阅类型（如部分 Team 账号），尽力从额度接口（只读）补全。
pub(crate) fn backfill_plan_from_usage(info: &mut RtTokenInfo) {
    if info.chatgpt_plan_type.is_some() {
        return;
    }
    let at = info.access_token.clone();
    let account_id = info.chatgpt_account_id.clone();
    if let Ok(usage) = fetch_account_usage(&at, account_id.as_deref(), false, false) {
        if let Some(plan) = usage.plan_type {
            info.chatgpt_plan_type = Some(plan);
        }
    }
}

/// 用 Refresh Token（rt）兑换 access_token（at）并解码账号信息。
/// 输入可为 JSON（自动提取 refresh_token）或原始 rt；rt 一次性使用，兑换后返回新的 rt。
#[tauri::command]
pub(crate) async fn exchange_refresh_token(input: String) -> Result<RtTokenInfo, String> {
    let rt = extract_refresh_token(&input)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut info = exchange_rt_for_at(&rt)?;
        backfill_plan_from_usage(&mut info);
        Ok::<RtTokenInfo, String>(info)
    })
    .await
    .map_err(|e| format!("兑换任务失败：{e}"))?
}

/// 仅当认证内容含 Personal Access Token（codex 可用的认证格式）时才写入 ~/.codex/auth.json。
/// rt 账号（无 PAT）不会覆盖本地 auth.json。
pub(crate) fn apply_auth_json_if_pat(content: &str) {
    if extract_personal_access_token(content).is_some() {
        let _ = apply_auth_json(content);
    }
}

pub(crate) fn apply_auth_json(content: &str) -> Result<(), String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_auth_json_credential_prefers_pat() {
        // 本应用写入的格式：personal_access_token（不限定 token 前缀）。
        let content = r#"{"OPENAI_API_KEY": null, "personal_access_token": "at-pat-token"}"#;
        match resolve_auth_json_credential(content) {
            Some(AuthJsonCredential::Pat(token)) => assert_eq!(token, "at-pat-token"),
            other => panic!("应为 PAT，得到 {other:?}"),
        }
    }

    #[test]
    fn resolve_auth_json_credential_falls_back_to_refresh_token() {
        // Codex CLI 登录格式：tokens 嵌套 refresh_token。
        let content =
            r#"{"tokens": {"id_token": "x", "access_token": "y", "refresh_token": "rt-nested"}}"#;
        match resolve_auth_json_credential(content) {
            Some(AuthJsonCredential::RefreshToken(rt)) => assert_eq!(rt, "rt-nested"),
            other => panic!("应为 rt，得到 {other:?}"),
        }
    }

    #[test]
    fn resolve_auth_json_credential_unsupported_returns_none() {
        assert!(resolve_auth_json_credential("{}").is_none());
        assert!(resolve_auth_json_credential(r#"{"foo": "bar"}"#).is_none());
        assert!(resolve_auth_json_credential("not json").is_none());
        // personal_access_token 为 null（rt 账号存库格式）→ 无 PAT，也无 rt。
        assert!(resolve_auth_json_credential(r#"{"personal_access_token": null}"#).is_none());
    }

    #[test]
    fn extract_rt_from_json() {
        let input = r#"{"access_token":"x","refresh_token":"rt-abc"}"#;
        assert_eq!(extract_refresh_token(input).unwrap(), "rt-abc");
    }

    #[test]
    fn extract_rt_from_raw() {
        assert_eq!(
            extract_refresh_token("rt-raw-token").unwrap(),
            "rt-raw-token"
        );
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
}
