use crate::db::{get_config_value, set_config_value};
use crate::state::AppState;
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::process::Stdio;
use std::sync::OnceLock;
use std::thread;
use std::time::Duration;

/// 启动时获取并缓存的 Codex CLI 版本号（用于 User-Agent）。
static CODEX_VERSION: OnceLock<String> = OnceLock::new();

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

/// macOS 上桌面应用捆绑的 Codex CLI 绝对路径候选（含用户级 ~/Applications 安装）。
#[cfg(target_os = "macos")]
fn desktop_codex_executable_candidates() -> Vec<PathBuf> {
    let mut directories = vec![PathBuf::from("/Applications")];
    if let Some(home) = dirs::home_dir() {
        directories.push(home.join("Applications"));
    }
    let mut candidates = Vec::new();
    for base in directories {
        for app in ["ChatGPT.app", "Codex.app"] {
            candidates.push(
                base.join(app)
                    .join("Contents")
                    .join("Resources")
                    .join("codex"),
            );
        }
    }
    candidates
}

#[cfg(not(target_os = "macos"))]
fn desktop_codex_executable_candidates() -> Vec<PathBuf> {
    Vec::new()
}

/// 执行 `codex --version` 并提取版本号（失败返回 None）。
/// 同时检查 stdout / stderr 的版本行，忽略警告；限制等待时间，避免异常安装一直卡住检测。
fn run_codex_version(mut command: Command) -> Option<String> {
    let mut child = command
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;
    let started = std::time::Instant::now();
    let output = loop {
        match child.try_wait() {
            Ok(Some(_)) => break child.wait_with_output().ok()?,
            Ok(None) if started.elapsed() < Duration::from_secs(5) => {
                thread::sleep(Duration::from_millis(50));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    };
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

fn local_desktop_codex_version() -> Option<String> {
    for executable in desktop_codex_executable_candidates() {
        if let Some(version) = run_codex_version(Command::new(executable)) {
            return Some(version);
        }
    }
    None
}

/// 只检测独立 CLI，不把 PATH 中指向桌面内置引擎的软链接当作独立安装。
fn local_codex_cli_version() -> Option<String> {
    #[cfg(target_os = "macos")]
    let search_path = macos_cli_search_path()?;
    #[cfg(not(target_os = "macos"))]
    let search_path = std::env::var_os("PATH")?;

    let desktop_executables: HashSet<PathBuf> = desktop_codex_executable_candidates()
        .into_iter()
        .filter_map(|path| fs::canonicalize(path).ok())
        .collect();
    #[cfg(target_os = "windows")]
    let executable_names = ["codex.exe", "codex.cmd", "codex.bat"];
    #[cfg(not(target_os = "windows"))]
    let executable_names = ["codex"];

    let mut checked = HashSet::new();
    for directory in std::env::split_paths(&search_path) {
        for name in executable_names {
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
            let mut command = Command::new(executable);
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
    local_desktop_codex_version().or_else(local_codex_cli_version)
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
    let cli = tauri::async_runtime::spawn_blocking(local_codex_cli_version);
    let desktop = tauri::async_runtime::spawn_blocking(local_desktop_codex_version);
    CodexVersions {
        cli: cli.await.unwrap_or(None),
        desktop: desktop.await.unwrap_or(None),
    }
}
