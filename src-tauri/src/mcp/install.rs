use serde::Serialize;
use serde_json::{json, Value};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

const SERVER_NAME: &str = "codex-portal";

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ClaudeMcpStatus {
    ClaudeNotFound,
    NotInstalled,
    Installed,
    Outdated,
}

fn config_path() -> Result<PathBuf, String> {
    dirs::home_dir().map(|home| home.join(".claude.json"))
        .ok_or_else(|| "无法获取用户目录。".into())
}

fn status(config: &Value, executable: &Path) -> ClaudeMcpStatus {
    match config.get("mcpServers").and_then(|servers| servers.get(SERVER_NAME)) {
        None => ClaudeMcpStatus::NotInstalled,
        Some(entry) if entry.get("command").and_then(Value::as_str).is_some_and(|command| Path::new(command) == executable)
            && entry.get("args") == Some(&json!(["mcp"])) => ClaudeMcpStatus::Installed,
        Some(_) => ClaudeMcpStatus::Outdated,
    }
}

fn status_at(path: &Path, executable: &Path) -> Result<ClaudeMcpStatus, String> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(ClaudeMcpStatus::ClaudeNotFound),
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
        "type": "stdio", "command": command, "args": ["mcp"], "env": {}
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

#[tauri::command]
pub(crate) fn get_claude_mcp_status() -> Result<ClaudeMcpStatus, String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    status_at(&config_path()?, &executable)
}

#[tauri::command]
pub(crate) fn install_claude_mcp() -> Result<(), String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    install_at(&config_path()?, &executable)
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
        assert_eq!(status(&empty, &fixture.executable), ClaudeMcpStatus::Installed);
    }

    #[test]
    fn status_covers_missing_not_installed_installed_and_outdated() {
        let fixture = TestConfig::new();
        assert_eq!(status_at(&fixture.path, &fixture.executable).unwrap(), ClaudeMcpStatus::ClaudeNotFound);
        assert!(install_at(&fixture.path, &fixture.executable).is_err());
        assert!(!fixture.path.exists());
        for config in [json!({}), json!({"mcpServers": {"another": {}}})] {
            fixture.write(&config);
            assert_eq!(status_at(&fixture.path, &fixture.executable).unwrap(), ClaudeMcpStatus::NotInstalled);
        }
        install_at(&fixture.path, &fixture.executable).unwrap();
        assert_eq!(status_at(&fixture.path, &fixture.executable).unwrap(), ClaudeMcpStatus::Installed);
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
            assert_eq!(status_at(&fixture.path, &fixture.executable).unwrap(), ClaudeMcpStatus::Outdated);
        }
        for (status, expected) in [
            (ClaudeMcpStatus::ClaudeNotFound, "claudeNotFound"),
            (ClaudeMcpStatus::NotInstalled, "notInstalled"),
            (ClaudeMcpStatus::Installed, "installed"),
            (ClaudeMcpStatus::Outdated, "outdated"),
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
        assert_eq!(status_at(&target, &fixture.executable).unwrap(), ClaudeMcpStatus::Installed);
        let config: Value = serde_json::from_slice(&fs::read(&target).unwrap()).unwrap();
        assert_eq!(config["numStartups"], 42);
        assert_eq!(fs::read_dir(target_directory).unwrap().count(), 1);
    }
}
