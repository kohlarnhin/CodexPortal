use crate::codex::version::codex_cli_user_agent;
use serde::de::DeserializeOwned;
use std::io::Write;
use std::process::Command;
use std::process::Stdio;

pub(crate) fn curl_config_quote(value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

pub(crate) fn append_curl_header(
    config: &mut String,
    name: &str,
    value: &str,
) -> Result<(), String> {
    if value.chars().any(char::is_control) {
        return Err("请求头包含无效字符".to_string());
    }

    config.push_str("header = ");
    config.push_str(&curl_config_quote(&format!("{name}: {value}")));
    config.push('\n');
    Ok(())
}

/// 执行一条 curl 配置并返回响应体与 HTTP 状态码。
pub(crate) fn run_curl(config: &str) -> Result<(String, u16), String> {
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

pub(crate) fn curl_get_json<T: DeserializeOwned>(
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
    append_curl_header(&mut config, "User-Agent", &codex_cli_user_agent())?;

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
