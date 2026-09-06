use crate::process::{command, output_with_timeout};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::Duration;

fn add_directory(directories: &mut Vec<PathBuf>, path: PathBuf) {
    if path.is_dir() && !directories.contains(&path) {
        directories.push(path);
    }
}

/// Explorer 启动的应用也能找到 npm、WinGet 和常见用户级 CLI 安装。
pub(super) fn cli_search_path() -> Option<OsString> {
    let mut directories = std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect::<Vec<_>>())
        .unwrap_or_default();
    if let Some(app_data) = std::env::var_os("APPDATA") {
        add_directory(&mut directories, PathBuf::from(app_data).join("npm"));
    }
    if let Some(local_data) = std::env::var_os("LOCALAPPDATA") {
        add_directory(
            &mut directories,
            PathBuf::from(local_data).join("Microsoft/WinGet/Links"),
        );
    }
    if let Some(home) = dirs::home_dir() {
        for suffix in [".local/bin", ".codex/bin", ".volta/bin", "scoop/shims"] {
            add_directory(&mut directories, home.join(suffix));
        }
    }
    std::env::join_paths(directories).ok()
}

/// 使用当前用户的包注册信息，避免遍历受保护的 WindowsApps 目录。
fn store_installation_roots() -> Vec<PathBuf> {
    let powershell = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .map(|root| root.join("System32/WindowsPowerShell/v1.0/powershell.exe"))
        .unwrap_or_else(|| PathBuf::from("powershell.exe"));
    let mut probe = command(powershell);
    probe.args([
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        r#"$ErrorActionPreference = 'Stop';
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false);
$packages = @(Get-AppxPackage -Name 'OpenAI.Codex*'; Get-AppxPackage -Name 'OpenAI.ChatGPT*');
$locations = @($packages | Sort-Object Version -Descending | Select-Object -ExpandProperty InstallLocation -Unique);
ConvertTo-Json -InputObject $locations -Compress"#,
    ]);
    let Some(output) = output_with_timeout(probe, Duration::from_secs(5)) else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    let text = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str::<Vec<String>>(text.trim_start_matches('\u{feff}').trim())
        .unwrap_or_default()
        .into_iter()
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .collect()
}

fn add_bundled_executables(candidates: &mut Vec<PathBuf>, root: &Path) {
    for suffix in ["resources/codex.exe", "app/resources/codex.exe"] {
        let executable = root.join(suffix);
        if executable.is_file() && !candidates.contains(&executable) {
            candidates.push(executable);
        }
    }
}

pub(super) fn desktop_executable_candidates() -> Vec<PathBuf> {
    let mut roots = store_installation_roots();
    if let Some(local_data) = std::env::var_os("LOCALAPPDATA") {
        let base = PathBuf::from(local_data);
        for suffix in ["Programs/Codex", "Programs/ChatGPT", "Codex", "ChatGPT"] {
            add_directory(&mut roots, base.join(suffix));
        }
    }
    for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(base) = std::env::var_os(variable).map(PathBuf::from) {
            for suffix in ["Codex", "ChatGPT", "OpenAI/Codex", "OpenAI/ChatGPT"] {
                add_directory(&mut roots, base.join(suffix));
            }
        }
    }

    let mut candidates = Vec::new();
    for root in roots {
        add_bundled_executables(&mut candidates, &root);
        // 兼容将当前版本放在 app-<version> 子目录的桌面安装方式。
        if let Ok(entries) = std::fs::read_dir(&root) {
            let mut versions: Vec<PathBuf> = entries
                .flatten()
                .filter(|entry| entry.file_name().to_string_lossy().starts_with("app-"))
                .map(|entry| entry.path())
                .filter(|path| path.is_dir())
                .collect();
            versions.sort_by_cached_key(|path| {
                path.file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .trim_start_matches("app-")
                    .split('.')
                    .map(|part| part.parse::<u64>().unwrap_or_default())
                    .collect::<Vec<_>>()
            });
            for version in versions.into_iter().rev() {
                add_bundled_executables(&mut candidates, &version);
            }
        }
    }
    candidates
}
