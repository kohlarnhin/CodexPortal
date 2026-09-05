use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use uuid::Uuid;

// 配置文件读写独立于账号/会话数据库，避免扫描会话时阻塞配置页面。
static CONFIG_FILE_LOCK: Mutex<()> = Mutex::new(());

fn codex_config_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let path = home.join(".codex").join("config.toml");
    // 保留用户通过软链接管理配置的方式，原子替换链接指向的文件。
    if fs::symlink_metadata(&path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return fs::canonicalize(&path).map_err(|e| format!("无法解析 config.toml 链接: {e}"));
    }
    Ok(path)
}

fn read_codex_config_file(path: &PathBuf) -> Result<String, String> {
    match fs::read_to_string(path) {
        Ok(content) => Ok(content),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(format!("无法读取 config.toml: {error}")),
    }
}

#[tauri::command]
pub(crate) fn get_codex_config() -> Result<String, String> {
    let _guard = CONFIG_FILE_LOCK.lock().map_err(|e| e.to_string())?;
    read_codex_config_file(&codex_config_path()?)
}

fn write_codex_config_file(
    path: &PathBuf,
    content: &str,
    expected_content: &str,
) -> Result<(), String> {
    if read_codex_config_file(path)? != expected_content {
        return Err("本地配置已更新，请重新载入后再保存。".to_string());
    }
    if content == expected_content {
        return Ok(());
    }
    let parent = path.parent().ok_or("配置文件路径无效")?;
    fs::create_dir_all(parent).map_err(|e| format!("无法创建配置目录: {e}"))?;
    let temporary = parent.join(format!(".config-{}.tmp", Uuid::new_v4()));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|e| format!("无法创建临时配置: {e}"))?;
    let result = (|| -> Result<(), String> {
        if let Ok(metadata) = fs::metadata(path) {
            file.set_permissions(metadata.permissions())
                .map_err(|e| e.to_string())?;
        }
        file.write_all(content.as_bytes())
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        // 写临时文件期间 Codex 也可能更新配置，再次确认后才替换。
        if read_codex_config_file(path)? != expected_content {
            return Err("本地配置已更新，请重新载入后再保存。".to_string());
        }
        fs::rename(&temporary, path).map_err(|e| format!("无法保存 config.toml: {e}"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[tauri::command]
pub(crate) fn save_codex_config(content: String, expected_content: String) -> Result<(), String> {
    let _guard = CONFIG_FILE_LOCK.lock().map_err(|e| e.to_string())?;
    write_codex_config_file(&codex_config_path()?, &content, &expected_content)
}
