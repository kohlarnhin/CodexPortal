use super::paths::codex_home;
use super::version::codex_command;
use crate::process::status_with_timeout;
use std::time::Duration;
use tauri::Emitter;

fn restart_app_server_daemon() -> Result<(), String> {
    let mut command = codex_command()?;
    command
        .args(["app-server", "daemon", "restart"])
        .env("CODEX_HOME", codex_home()?);
    let status = status_with_timeout(command, Duration::from_secs(30))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("重启命令执行失败（{status}）。"))
    }
}

/// 凭证已经切换成功；重启失败单独提示，不把已完成的切换报告为失败。
pub(crate) async fn restart_after_account_switch(app: &tauri::AppHandle) {
    crate::logging::info("codex-daemon", "执行 codex app-server daemon restart。");
    let result = tauri::async_runtime::spawn_blocking(restart_app_server_daemon)
        .await
        .map_err(|error| format!("Codex 重启任务失败：{error}"))
        .and_then(|result| result);
    match result {
        Ok(()) => crate::logging::info("codex-daemon", "Codex app-server daemon 已重启。"),
        Err(error) => {
            let message = format!(
                "账号已切换，但 Codex app-server 重启失败：{error}\n请手动执行 codex app-server daemon restart。"
            );
            crate::logging::error("codex-daemon", &message);
            let _ = app.emit("account-switch-warning", message);
        }
    }
    super::events::resume_after_account_switch(app);
}
