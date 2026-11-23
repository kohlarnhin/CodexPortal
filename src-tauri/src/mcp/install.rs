use crate::codex::config::{get_codex_config, save_codex_config};
use serde::Serialize;
use serde_json::{json, Value};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use toml_edit::{value, Array, DocumentMut, Item, Table, TableLike};

const SERVER_NAME: &str = "codex-portal";
const SERVER_ARG: &str = "mcp";
const CODEX_SERVERS_TABLE: &str = "mcp_servers";
const CODEX_SERVERS_TABLE_ERROR: &str = "Codex 的 mcp_servers 配置必须是 TOML 表。";
const CODEX_HTTP_FIELDS: &[&str] = &[
    "url",
    "auth",
    "bearer_token",
    "bearer_token_env_var",
    "http_headers",
    "env_http_headers",
    "http_headers_helper",
    "oauth",
    "oauth_resource",
];

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum McpInstallStatus {
    ClaudeNotFound,
    NotInstalled,
    Installed,
    Outdated,
}

fn config_path() -> Result<PathBuf, String> {
    dirs::home_dir().map(|home| home.join(".claude.json"))
        .ok_or_else(|| "无法获取用户目录。".into())
}

fn status(config: &Value, executable: &Path) -> McpInstallStatus {
    match config.get("mcpServers").and_then(|servers| servers.get(SERVER_NAME)) {
        None => McpInstallStatus::NotInstalled,
        Some(entry) if entry.get("command").and_then(Value::as_str).is_some_and(|command| Path::new(command) == executable)
            && entry.get("args") == Some(&json!([SERVER_ARG])) => McpInstallStatus::Installed,
        Some(_) => McpInstallStatus::Outdated,
    }
}

fn status_at(path: &Path, executable: &Path) -> Result<McpInstallStatus, String> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(McpInstallStatus::ClaudeNotFound),
        Err(error) => return Err(error.to_string()),
    };
    let config = serde_json::from_slice(&bytes).map_err(|error| format!("Claude Code 配置解析失败：{error}"))?;
    Ok(status(&config, executable))
}

fn merge(config: &mut Value, executable: &Path) -> Result<(), String> {
    let command = executable.to_str().ok_or_else(|| "无法读取 Codex Portal 程序路径。".to_string())?;
    let root = config.as_object_mut().ok_or_else(|| "Claude Code 配置必须是 JSON 对象。".to_string())?;
    let servers = root.entry("mcpServers").or_insert_with(|| json!({})).as_object_mut()
        .ok_or_else(|| "Claude Code 的 mcpServers 配置必须是 JSON 对象。".to_string())?;
    servers.insert(SERVER_NAME.into(), json!({
        "type": "stdio", "command": command, "args": [SERVER_ARG], "env": {}
    }));
    Ok(())
}

fn install_at(path: &Path, executable: &Path) -> Result<(), String> {
    let target = fs::canonicalize(path).map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound { "未检测到 Claude Code，请先启动 Claude Code。".into() }
        else { error.to_string() }
    })?;
    let bytes = fs::read(&target).map_err(|error| error.to_string())?;
    let mut config = serde_json::from_slice(&bytes).map_err(|error| format!("Claude Code 配置解析失败：{error}"))?;
    merge(&mut config, executable)?;
    let permissions = fs::metadata(&target).map_err(|error| error.to_string())?.permissions();
    let temp = target.with_file_name(format!(".claude-mcp-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> Result<(), String> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp).map_err(|error| error.to_string())?;
        file.set_permissions(permissions).map_err(|error| error.to_string())?;
        serde_json::to_writer_pretty(&mut file, &config).map_err(|error| error.to_string())?;
        file.write_all(b"\n").map_err(|error| error.to_string())?;
        drop(file);
        fs::rename(&temp, &target).map_err(|error| error.to_string())
    })();
    if result.is_err() { let _ = fs::remove_file(&temp); }
    result
}

#[tauri::command(async)]
pub(crate) fn get_claude_mcp_status() -> Result<McpInstallStatus, String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    status_at(&config_path()?, &executable)
}

#[tauri::command(async)]
pub(crate) fn install_claude_mcp() -> Result<(), String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    install_at(&config_path()?, &executable)
}

fn parse_codex_config(content: &str) -> Result<DocumentMut, String> {
    content
        .parse()
        .map_err(|_| "Codex 的 config.toml 格式无效，请修正后重试。".into())
}

fn codex_status(config: &DocumentMut, executable: &Path) -> Result<McpInstallStatus, String> {
    let Some(servers) = config.get(CODEX_SERVERS_TABLE) else {
        return Ok(McpInstallStatus::NotInstalled);
    };
    let servers = servers.as_table_like().ok_or(CODEX_SERVERS_TABLE_ERROR)?;
    let Some(server) = servers.get(SERVER_NAME) else {
        return Ok(McpInstallStatus::NotInstalled);
    };
    let Some(server) = server.as_table_like() else {
        return Ok(McpInstallStatus::Outdated);
    };

    let has_command = server
        .get("command")
        .and_then(Item::as_str)
        .is_some_and(|command| Path::new(command) == executable);
    let has_args = server.get("args").and_then(Item::as_array).is_some_and(|args| {
        args.len() == 1 && args.get(0).and_then(toml_edit::Value::as_str) == Some(SERVER_ARG)
    });
    let has_http_fields = CODEX_HTTP_FIELDS.iter().any(|key| server.contains_key(key));
    Ok(if has_command && has_args && !has_http_fields {
        McpInstallStatus::Installed
    } else {
        McpInstallStatus::Outdated
    })
}

fn set_codex_stdio(server: &mut dyn TableLike, command: &str) {
    // 切换为本地 STDIO，同时保留该服务的工具审批、超时等设置。
    for field in CODEX_HTTP_FIELDS {
        server.remove(field);
    }
    let mut args = Array::new();
    args.push(SERVER_ARG);
    server.insert("command", value(command));
    server.insert("args", value(args));
}

fn merge_codex(config: &mut DocumentMut, executable: &Path) -> Result<(), String> {
    let command = executable.to_str().ok_or("无法读取 Codex Portal 程序路径。")?;
    let servers = config.entry(CODEX_SERVERS_TABLE).or_insert_with(|| {
        let mut table = Table::new();
        table.set_implicit(true);
        Item::Table(table)
    });
    let servers = servers.as_table_like_mut().ok_or(CODEX_SERVERS_TABLE_ERROR)?;
    if let Some(server) = servers.get_mut(SERVER_NAME).and_then(Item::as_table_like_mut) {
        set_codex_stdio(server, command);
    } else {
        let mut server = Table::new();
        set_codex_stdio(&mut server, command);
        servers.insert(SERVER_NAME, Item::Table(server));
    }
    Ok(())
}

#[tauri::command(async)]
pub(crate) fn get_codex_mcp_status() -> Result<McpInstallStatus, String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let config = parse_codex_config(&get_codex_config()?)?;
    codex_status(&config, &executable)
}

#[tauri::command(async)]
pub(crate) fn install_codex_mcp() -> Result<(), String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let original = get_codex_config()?;
    let mut config = parse_codex_config(&original)?;
    if codex_status(&config, &executable)? != McpInstallStatus::Installed {
        merge_codex(&mut config, &executable)?;
        save_codex_config(config.to_string(), original)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestConfig {
        directory: PathBuf,
        path: PathBuf,
        executable: PathBuf,
    }

    impl TestConfig {
        fn new() -> Self {
            let directory = std::env::temp_dir().join(format!("portal-claude-mcp-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&directory).unwrap();
            Self { path: directory.join(".claude.json"), executable: directory.join("codex-portal"), directory }
        }

        fn write(&self, value: &Value) {
            fs::write(&self.path, serde_json::to_vec(value).unwrap()).unwrap();
        }
    }

    impl Drop for TestConfig {
        fn drop(&mut self) { let _ = fs::remove_dir_all(&self.directory); }
    }

    #[test]
    fn merge_preserves_other_keys_and_servers_and_replaces_only_portal() {
        let fixture = TestConfig::new();
        let mut config = json!({
            "projects": {"/test/project": {"allowedTools": ["Read"]}},
            "numStartups": 42,
            "mcpServers": {
                "another": {"type": "stdio", "command": "another-server", "args": ["serve"], "env": {"TEST": "value"}},
                "codex-portal": {"command": "old-location", "args": []}
            }
        });
        let original = config.clone();
        merge(&mut config, &fixture.executable).unwrap();
        assert_eq!(config["projects"], original["projects"]);
        assert_eq!(config["numStartups"], original["numStartups"]);
        assert_eq!(config["mcpServers"]["another"], original["mcpServers"]["another"]);
        assert_eq!(config["mcpServers"][SERVER_NAME], json!({
            "type": "stdio", "command": fixture.executable, "args": ["mcp"], "env": {}
        }));
        let mut empty = json!({"other": true});
        merge(&mut empty, &fixture.executable).unwrap();
        assert_eq!(empty["other"], true);
        assert_eq!(status(&empty, &fixture.executable), McpInstallStatus::Installed);
    }

    #[test]
    fn status_covers_missing_not_installed_installed_and_outdated() {
        let fixture = TestConfig::new();
        assert_eq!(status_at(&fixture.path, &fixture.executable).unwrap(), McpInstallStatus::ClaudeNotFound);
        assert!(install_at(&fixture.path, &fixture.executable).is_err());
        assert!(!fixture.path.exists());
        for config in [json!({}), json!({"mcpServers": {"another": {}}})] {
            fixture.write(&config);
            assert_eq!(status_at(&fixture.path, &fixture.executable).unwrap(), McpInstallStatus::NotInstalled);
        }
        install_at(&fixture.path, &fixture.executable).unwrap();
        assert_eq!(status_at(&fixture.path, &fixture.executable).unwrap(), McpInstallStatus::Installed);
        let config: Value = serde_json::from_slice(&fs::read(&fixture.path).unwrap()).unwrap();
        for (command, args) in [
            (json!(fixture.directory.join("moved-portal")), json!(["mcp"])),
            (json!(fixture.executable), json!([])),
            (json!(fixture.executable), json!(["mcp", "extra"])),
        ] {
            let mut config = config.clone();
            config["mcpServers"][SERVER_NAME]["command"] = command;
            config["mcpServers"][SERVER_NAME]["args"] = args;
            fixture.write(&config);
            assert_eq!(status_at(&fixture.path, &fixture.executable).unwrap(), McpInstallStatus::Outdated);
        }
        for (status, expected) in [
            (McpInstallStatus::ClaudeNotFound, "claudeNotFound"),
            (McpInstallStatus::NotInstalled, "notInstalled"),
            (McpInstallStatus::Installed, "installed"),
            (McpInstallStatus::Outdated, "outdated"),
        ] {
            assert_eq!(serde_json::to_value(status).unwrap(), expected);
        }
    }

    #[test]
    fn malformed_configuration_is_never_overwritten() {
        let fixture = TestConfig::new();
        for bytes in ["{incomplete", "[]", "{\"mcpServers\":false}"] {
            fs::write(&fixture.path, bytes).unwrap();
            assert!(install_at(&fixture.path, &fixture.executable).is_err());
            assert_eq!(fs::read_to_string(&fixture.path).unwrap(), bytes);
        }
        fs::write(&fixture.path, "{incomplete").unwrap();
        assert!(status_at(&fixture.path, &fixture.executable).is_err());
        assert_eq!(fs::read_dir(&fixture.directory).unwrap().count(), 1);
    }

    #[test]
    fn installation_preserves_unrelated_configuration_and_pretty_prints() {
        let fixture = TestConfig::new();
        let original = json!({"projects": {"/project": {"trusted": true}}, "mcpServers": {"other": {"command": "other"}}});
        fixture.write(&original);
        install_at(&fixture.path, &fixture.executable).unwrap();
        let contents = fs::read_to_string(&fixture.path).unwrap();
        let config: Value = serde_json::from_str(&contents).unwrap();
        assert_eq!(config["projects"], original["projects"]);
        assert_eq!(config["mcpServers"]["other"], original["mcpServers"]["other"]);
        assert!(contents.starts_with("{\n  \"mcpServers\": {\n    "));
        assert_eq!(fs::read_dir(&fixture.directory).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn atomic_install_resolves_symlinks_and_preserves_permissions() {
        use std::os::unix::fs::{symlink, PermissionsExt};

        let fixture = TestConfig::new();
        let target_directory = fixture.directory.join("config");
        fs::create_dir(&target_directory).unwrap();
        let target = target_directory.join("claude.json");
        fs::write(&target, b"{\"numStartups\":42}").unwrap();
        fs::set_permissions(&target, fs::Permissions::from_mode(0o600)).unwrap();
        symlink(&target, &fixture.path).unwrap();
        install_at(&fixture.path, &fixture.executable).unwrap();
        assert!(fs::symlink_metadata(&fixture.path).unwrap().file_type().is_symlink());
        assert_eq!(fs::metadata(&target).unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(status_at(&target, &fixture.executable).unwrap(), McpInstallStatus::Installed);
        let config: Value = serde_json::from_slice(&fs::read(&target).unwrap()).unwrap();
        assert_eq!(config["numStartups"], 42);
        assert_eq!(fs::read_dir(target_directory).unwrap().count(), 1);
    }
}
