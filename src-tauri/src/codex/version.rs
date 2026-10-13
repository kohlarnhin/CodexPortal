use crate::db::{get_config_value, set_config_value};
use crate::process::{command, output_with_timeout};
use crate::state::AppState;
use serde::Serialize;
use std::collections::HashSet;
use std::ffi::OsString;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::OnceLock;
use std::time::Duration;

/// 启动时获取并缓存的 Codex CLI 版本号（用于 User-Agent）。
static CODEX_VERSION: OnceLock<String> = OnceLock::new();

#[cfg(windows)]
const CLI_EXECUTABLE_NAMES: &[&str] = &["codex.exe", "codex.cmd", "codex.bat"];
#[cfg(not(windows))]
const CLI_EXECUTABLE_NAMES: &[&str] = &["codex"];

/// 构造与 Codex CLI 一致的 User-Agent（originator/版本/系统/架构）。
/// 版本号使用启动时获取并保存的 Codex CLI 版本；未获取到时回退为本应用版本。
pub(crate) fn codex_cli_user_agent() -> String {
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
            home_dir.join(".codex/bin"),
            home_dir.join(".npm-global/bin"),
            home_dir.join(".volta/bin"),
            home_dir.join(".asdf/shims"),
            home_dir.join(".local/share/mise/shims"),
            home_dir.join(".bun/bin"),
            home_dir.join(".cargo/bin"),
            home_dir.join(".local/share/pnpm/bin"),
        ] {
            add_existing_cli_path(&mut paths, path);
        }

        // nvm 安装的 node 全局 bin（~/.nvm/versions/node/<version>/bin），
        // `npm i -g @openai/codex` 的常见落点。
        if let Ok(entries) = std::fs::read_dir(home_dir.join(".nvm").join("versions").join("node"))
        {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    add_existing_cli_path(&mut paths, entry.path().join("bin"));
                }
            }
        }
    }

    std::env::join_paths(paths).ok()
}

/// ChatGPT 桌面端捆绑的 Codex 引擎（含用户级 ~/Applications 安装）。
#[cfg(target_os = "macos")]
fn desktop_codex_executable_candidates() -> Vec<PathBuf> {
    let mut directories = vec![PathBuf::from("/Applications")];
    if let Some(home) = dirs::home_dir() {
        directories.push(home.join("Applications"));
    }
    directories
        .into_iter()
        .map(|base| base.join("ChatGPT.app/Contents/Resources/codex"))
        .collect()
}

#[cfg(windows)]
fn desktop_codex_executable_candidates() -> Vec<PathBuf> {
    super::windows::desktop_executable_candidates()
}

#[cfg(not(any(target_os = "macos", windows)))]
fn desktop_codex_executable_candidates() -> Vec<PathBuf> {
    Vec::new()
}

fn codex_cli_search_path() -> Option<std::ffi::OsString> {
    #[cfg(target_os = "macos")]
    {
        macos_cli_search_path()
    }
    #[cfg(windows)]
    {
        super::windows::cli_search_path()
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        std::env::var_os("PATH")
    }
}

#[derive(Clone)]
pub(super) struct CodexExecutable {
    pub(super) path: PathBuf,
    pub(super) is_desktop: bool,
    search_path: Option<OsString>,
}

impl CodexExecutable {
    pub(super) fn label(&self) -> &'static str {
        if self.is_desktop { "ChatGPT 桌面内置引擎" } else { "Codex CLI" }
    }

    pub(super) fn command(&self) -> Command {
        let mut command = command(&self.path);
        if let Some(path) = &self.search_path {
            command.env("PATH", path);
        }
        command
    }

    pub(super) fn with_path(&self, path: PathBuf) -> Self {
        Self { path, ..self.clone() }
    }
}

/// 同时发现 CLI 和 ChatGPT 引擎；命令能力与运行状态由连接层逐个探测。
/// 按真实路径去重，PATH 中指向 ChatGPT 引擎的软链接仍归为桌面端。
pub(super) fn codex_executable_candidates() -> Vec<CodexExecutable> {
    let search_path = codex_cli_search_path();
    let desktop_candidates = desktop_codex_executable_candidates();
    let desktop_paths: HashSet<PathBuf> = desktop_candidates
        .iter()
        .filter_map(|path| fs::canonicalize(path).ok())
        .collect();
    let mut candidates = Vec::new();
    let mut seen = HashSet::new();
    let mut add = |path: PathBuf, is_desktop: bool| {
        if !path.is_file() { return; }
        let resolved = fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
        if seen.insert(resolved.clone()) {
            candidates.push(CodexExecutable {
                path,
                is_desktop: is_desktop || desktop_paths.contains(&resolved),
                search_path: search_path.clone(),
            });
        }
    };
    if let Some(path) = &search_path {
        for directory in std::env::split_paths(path) {
            for name in CLI_EXECUTABLE_NAMES {
                add(directory.join(name), false);
            }
        }
    }
    for path in desktop_candidates {
        add(path, true);
    }
    candidates
}

/// 执行 `codex --version` 并提取版本号（失败返回 None）。
/// 同时检查 stdout / stderr 的版本行，忽略警告；限制等待时间，避免异常安装一直卡住检测。
fn run_codex_version(mut command: Command) -> Option<String> {
    command.arg("--version");
    let output = output_with_timeout(command, Duration::from_secs(5))?;
    if !output.status.success() {
        return None;
    }
    for bytes in [&output.stdout, &output.stderr] {
        for line in String::from_utf8_lossy(bytes).lines() {
            if let Some(version) = line.trim().strip_prefix("codex-cli ") {
                if let Some(version) = version.split_whitespace().next() {
                    return Some(version.to_string());
                }
            }
        }
    }
    None
}

fn local_desktop_codex_version(desktop_executables: &[PathBuf]) -> Option<String> {
    for executable in desktop_executables {
        if let Some(version) = run_codex_version(command(executable)) {
            return Some(version);
        }
    }
    None
}

/// 只检测独立 CLI，不把 PATH 中指向桌面内置引擎的软链接当作独立安装。
fn local_codex_cli_version(desktop_candidates: &[PathBuf]) -> Option<String> {
    let search_path = codex_cli_search_path()?;

    let desktop_executables: HashSet<PathBuf> = desktop_candidates
        .iter()
        .filter_map(|path| fs::canonicalize(path).ok())
        .collect();
    let mut checked = HashSet::new();
    for directory in std::env::split_paths(&search_path) {
        for name in CLI_EXECUTABLE_NAMES {
            let executable = directory.join(name);
            if !executable.is_file() {
                continue;
            }
            let Ok(resolved) = fs::canonicalize(&executable) else {
                continue;
            };
            if desktop_executables.contains(&resolved) || !checked.insert(resolved) {
                continue;
            }
            let mut command = command(executable);
            command.env("PATH", &search_path);
            if let Some(version) = run_codex_version(command) {
                return Some(version);
            }
        }
    }
    None
}

/// User-Agent 沿用优先桌面内置引擎、其次独立 CLI 的版本选择方式。
fn local_codex_version() -> Option<String> {
    let desktop_candidates = desktop_codex_executable_candidates();
    local_desktop_codex_version(&desktop_candidates)
        .or_else(|| local_codex_cli_version(&desktop_candidates))
}

/// 启动时获取 Codex CLI 版本号并缓存/入库，供 User-Agent 使用。
/// 优先用本机 `codex --version`，失败则回退到已保存的值。
pub(crate) fn sync_codex_version(state: &AppState) {
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

#[derive(Serialize)]
pub(crate) struct CodexVersions {
    pub(crate) cli: Option<String>,
    pub(crate) desktop: Option<String>,
}

/// 两路独立实时检测；未查到返回 null，不使用旧缓存冒充当前安装状态。
#[tauri::command]
pub(crate) async fn get_codex_versions() -> CodexVersions {
    let candidates = tauri::async_runtime::spawn_blocking(desktop_codex_executable_candidates)
        .await
        .unwrap_or_default();
    let cli_candidates = candidates.clone();
    let cli =
        tauri::async_runtime::spawn_blocking(move || local_codex_cli_version(&cli_candidates));
    let desktop =
        tauri::async_runtime::spawn_blocking(move || local_desktop_codex_version(&candidates));
    CodexVersions {
        cli: cli.await.unwrap_or(None),
        desktop: desktop.await.unwrap_or(None),
    }
}
