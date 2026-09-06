use std::path::PathBuf;

/// 与原生 Codex 共用数据目录；不推断或扫描 WSL 中的目录。
pub(crate) fn codex_home() -> Result<PathBuf, String> {
    if let Some(value) = std::env::var_os("CODEX_HOME").filter(|value| !value.is_empty()) {
        // absolute 同时处理普通相对路径及 Windows 的盘符相对路径。
        return std::path::absolute(PathBuf::from(value))
            .map_err(|error| format!("无法解析 CODEX_HOME: {error}"));
    }

    dirs::home_dir()
        .map(|home| home.join(".codex"))
        .ok_or_else(|| "无法获取用户主目录".to_string())
}
