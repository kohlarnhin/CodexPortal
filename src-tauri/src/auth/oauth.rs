use crate::auth::{
    backfill_plan_from_usage, decode_access_token, urlencode, RtTokenInfo, OAUTH_CLIENT_ID,
    OAUTH_TOKEN_URL,
};
use crate::codex::version::codex_cli_user_agent;
use crate::http::{append_curl_header, curl_config_quote, run_curl};
use crate::state::AppState;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use serde::Deserialize;
use serde::Serialize;
use sha2::Digest;
use sha2::Sha256;
use std::io::BufRead;
use std::io::BufReader;
use std::io::Write;
use std::net::TcpListener;
use std::net::TcpStream;
use std::thread;
use tauri::Manager;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
pub(crate) struct OAuthLoginInfo {
    pub(crate) url: String,
    #[serde(rename = "redirectUri")]
    pub(crate) redirect_uri: String,
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
        (
            "scope",
            "openid profile email offline_access api.connectors.read api.connectors.invoke",
        ),
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
pub(crate) async fn start_oauth_login(app: tauri::AppHandle) -> Result<OAuthLoginInfo, String> {
    let (verifier, challenge) = generate_pkce();
    let state = generate_oauth_state();

    let listener = bind_oauth_listener().map_err(|e| format!("无法启动本地回调服务器：{e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
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
pub(crate) async fn check_oauth_callback(
    state: State<'_, AppState>,
) -> Result<Option<RtTokenInfo>, String> {
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
        let mut info = exchange_oauth_code(
            &code,
            &redirect_uri.unwrap_or_default(),
            &verifier.unwrap_or_default(),
        )?;
        // Team 等账号的 JWT 可能不带订阅类型：尽力从额度接口补全，徽标立即显示。
        backfill_plan_from_usage(&mut info);
        Ok::<RtTokenInfo, String>(info)
    })
    .await
    .map_err(|e| format!("OAuth 兑换任务失败：{e}"))??;

    clear_oauth_session(&state);
    Ok(Some(info))
}

/// 用户手动粘贴本地回调地址（在其它设备/浏览器登录后）完成认证。
#[tauri::command]
pub(crate) async fn complete_oauth_login(
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
        let mut info = exchange_oauth_code(
            &code,
            &redirect_uri.unwrap_or_default(),
            &verifier.unwrap_or_default(),
        )?;
        // Team 等账号的 JWT 可能不带订阅类型：尽力从额度接口补全，徽标立即显示。
        backfill_plan_from_usage(&mut info);
        Ok::<RtTokenInfo, String>(info)
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
