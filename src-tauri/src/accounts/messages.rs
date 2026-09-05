use crate::accounts::usage::{
    account_usage_context, at_is_due, begin_account_refresh, persist_rotated_access_token,
};
use crate::auth::{
    exchange_rt_for_at, extract_personal_access_token, PersonalAccessTokenMetadata,
    PERSONAL_ACCESS_TOKEN_METADATA_URL,
};
use crate::codex::version::codex_cli_user_agent;
use crate::http::{append_curl_header, curl_config_quote, curl_get_json};
use crate::state::AppState;
use rusqlite::params;
use serde::Serialize;
use serde_json::Value;
use std::io::BufRead;
use std::io::BufReader;
use std::io::Write;
use std::process::Command;
use std::process::Stdio;
use tauri::Emitter;
use tauri::State;

const CODEX_RESPONSES_URL: &str = "https://chatgpt.com/backend-api/codex/responses";

const TEST_MESSAGE_CONTENT: &str = "Introduce yourself.";

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
    append_curl_header(&mut config, "User-Agent", &codex_cli_user_agent())?;
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
                if event.get("type").and_then(|value| value.as_str())
                    == Some("response.output_text.delta")
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
        let suffix = if body.chars().count() > 500 {
            "…"
        } else {
            ""
        };
        return format!("测试请求失败（HTTP {status}）：{truncated}{suffix}");
    }
    format!("测试请求失败（HTTP {status}）")
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct TestMessageResult {
    pub(crate) model: String,
    pub(crate) input: String,
    pub(crate) output: String,
}

#[derive(Debug, Clone, Serialize)]
struct TestOutputDelta {
    #[serde(rename = "accountId")]
    account_id: String,
    delta: String,
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
        let suffix = if body.chars().count() > 500 {
            "…"
        } else {
            ""
        };
        return format!("{truncated}{suffix}");
    }
    "(无返回内容)".to_string()
}

/// 用账号调用 Codex 模型接口（chatgpt.com 后端 /responses）发送 "hello"，验证账号额度可用性。
/// 所有账号类型均支持：有 PAT 用 PAT（account_id 经 whoami 获取）；
/// 无 PAT（OAuth / rt 账号）用 at + 存库 account_id，at 临近过期先兑换。
#[tauri::command]
pub(crate) async fn send_test_message(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    model: String,
) -> Result<TestMessageResult, String> {
    let _guard = begin_account_refresh(&state, &id, None)?;
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

    // PAT 优先，其次 at；无 PAT 的 rt 账号且 at 临近过期：先用 rt 兑换新 at。
    let (mut bearer, mut account_id, mut fedramp, needs_whoami) = account_usage_context(
        &auth_json_content,
        access_token.as_deref(),
        refresh_token.as_deref(),
        chatgpt_account_id.as_deref(),
        fedramp,
    );
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
                persist_rotated_access_token(&db, &id, &expected_rt, &info)?;
            }
            bearer = Some(info.access_token);
            account_id = info.chatgpt_account_id;
            fedramp = false;
        }
    }

    let bearer = bearer.ok_or_else(|| "该账号暂无可用认证，无法测试额度".to_string())?;

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
        // PAT 账号运行时经 whoami 获取 account_id / fedramp；at 账号用存库值。
        let (account_id, fedramp) = if let Some(id) = account_id {
            (Some(id), fedramp)
        } else if needs_whoami {
            let metadata = curl_get_json::<PersonalAccessTokenMetadata>(
                PERSONAL_ACCESS_TOKEN_METADATA_URL,
                &bearer,
                None,
                false,
            )
            .map_err(|error| format!("Token 校验失败：{error}"))?;
            (
                Some(metadata.chatgpt_account_id),
                metadata.chatgpt_account_is_fedramp,
            )
        } else {
            (None, fedramp)
        };
        curl_post_stream(
            &app,
            CODEX_RESPONSES_URL,
            &bearer,
            account_id.as_deref().unwrap_or(""),
            &id,
            fedramp,
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
