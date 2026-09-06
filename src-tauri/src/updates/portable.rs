use base64::Engine;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::Emitter;
use tauri_plugin_updater::UpdaterExt;
use uuid::Uuid;

static INSTALLING: AtomicBool = AtomicBool::new(false);

struct InstallGuard;

impl Drop for InstallGuard {
    fn drop(&mut self) {
        INSTALLING.store(false, Ordering::Release);
    }
}

#[derive(Clone, Serialize)]
struct Progress {
    stage: &'static str,
    downloaded: u64,
    total: Option<u64>,
}

pub(super) async fn install(app: tauri::AppHandle, expected_version: String) -> Result<(), String> {
    if INSTALLING.swap(true, Ordering::AcqRel) {
        return Err("正在更新，请稍候。".to_string());
    }
    let _guard = InstallGuard;
    let mut update = app
        .updater_builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| format!("检查更新失败：{error}"))?
        .ok_or("当前已是最新版本，请重新检查更新。")?;
    if update.version != expected_version {
        return Err("可用版本已变化，请重新检查更新。".to_string());
    }
    update.timeout = Some(Duration::from_secs(300));
    let mut downloaded = 0_u64;
    // 复用 Tauri 下载器的 minisign 签名验证，不调用其 Windows 安装器。
    let bytes = update
        .download(
            |chunk, total| {
                downloaded += chunk as u64;
                let _ = app.emit(
                    "portable-update-progress",
                    Progress {
                        stage: "downloading",
                        downloaded,
                        total,
                    },
                );
            },
            || {},
        )
        .await
        .map_err(|error| format!("下载或校验更新失败：{error}"))?;
    if !is_windows_executable(&bytes) {
        return Err("更新文件不是有效的 Windows 可执行程序。".to_string());
    }
    let _ = app.emit(
        "portable-update-progress",
        Progress {
            stage: "installing",
            downloaded,
            total: Some(downloaded),
        },
    );
    tauri::async_runtime::spawn_blocking(move || prepare_handoff(&bytes))
        .await
        .map_err(|error| format!("无法准备更新：{error}"))??;
    let _ = app.emit(
        "portable-update-progress",
        Progress {
            stage: "restarting",
            downloaded,
            total: Some(downloaded),
        },
    );
    // helper 确认持有当前进程句柄后才退出，数据库由正常退出流程关闭。
    app.exit(0);
    Ok(())
}

fn is_windows_executable(bytes: &[u8]) -> bool {
    if bytes.len() < 64 || &bytes[..2] != b"MZ" {
        return false;
    }
    let offset = u32::from_le_bytes(bytes[60..64].try_into().unwrap()) as usize;
    bytes.get(offset..offset.saturating_add(4)) == Some(b"PE\0\0")
}

fn prepare_handoff(bytes: &[u8]) -> Result<(), String> {
    let target = std::env::current_exe().map_err(|error| error.to_string())?;
    let directory = target.parent().ok_or("无法确定程序所在目录。")?;
    let id = Uuid::new_v4();
    let staged = directory.join(format!(".codex-portal-{id}.exe"));
    let backup = directory.join(format!(".codex-portal-{id}.backup.exe"));
    let work = std::env::temp_dir().join(format!("codex-portal-update-{id}"));
    fs::create_dir(&work).map_err(|error| format!("无法创建更新临时目录：{error}"))?;
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&staged)
            .map_err(|error| {
                format!("无法写入程序目录，请将免安装程序移到可写目录后重试：{error}")
            })?;
        file.write_all(bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);
        start_helper(
            &target,
            &staged,
            &backup,
            &work,
            &format!("{:x}", Sha256::digest(bytes)),
        )
    })();
    if result.is_err() {
        let _ = fs::remove_file(&staged);
        let _ = fs::remove_dir_all(&work);
    }
    result
}

fn start_helper(
    target: &Path,
    staged: &Path,
    backup: &Path,
    work: &Path,
    hash: &str,
) -> Result<(), String> {
    let script = include_str!("portable-update.ps1");
    let encoded = base64::engine::general_purpose::STANDARD.encode(
        script
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>(),
    );
    let powershell = std::env::var_os("SystemRoot")
        .map(std::path::PathBuf::from)
        .ok_or("无法定位 Windows 系统目录。")?
        .join("System32/WindowsPowerShell/v1.0/powershell.exe");
    let mut helper = crate::process::command(powershell)
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            &encoded,
        ])
        .env("CODEX_PORTAL_UPDATE_TARGET", target)
        .env("CODEX_PORTAL_UPDATE_STAGED", staged)
        .env("CODEX_PORTAL_UPDATE_BACKUP", backup)
        .env("CODEX_PORTAL_UPDATE_WORK", work)
        .env("CODEX_PORTAL_UPDATE_HASH", hash)
        .env("CODEX_PORTAL_UPDATE_PARENT", std::process::id().to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("无法启动更新助手：{error}"))?;
    let started = Instant::now();
    let result = loop {
        if work.join("ready").is_file() {
            break Ok(());
        }
        match helper.try_wait() {
            Ok(Some(_)) => break Err("更新助手启动失败，当前程序保持运行。".to_string()),
            Err(error) => break Err(format!("无法检查更新助手：{error}")),
            Ok(None) if started.elapsed() >= Duration::from_secs(10) => {
                break Err("更新助手启动超时，当前程序保持运行。".to_string());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
        }
    };
    if result.is_err() {
        let _ = helper.kill();
        let _ = helper.wait();
    }
    result
}
