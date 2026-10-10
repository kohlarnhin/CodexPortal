use std::ffi::OsStr;
use std::process::Command;
use std::process::{ExitStatus, Output, Stdio};
use std::time::{Duration, Instant};

/// 后台工具在 Windows GUI 应用中不弹出控制台窗口。
pub(crate) fn command(program: impl AsRef<OsStr>) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    // 在所有平台显式设置 stdin，避免后台工具等待用户输入。
    command.stdin(std::process::Stdio::null());
    command
}

pub(crate) fn curl_command() -> Command {
    #[cfg(windows)]
    {
        if let Some(root) = std::env::var_os("SystemRoot") {
            let executable = std::path::PathBuf::from(root)
                .join("System32")
                .join("curl.exe");
            if executable.is_file() {
                return command(executable);
            }
        }
        command("curl.exe")
    }
    #[cfg(not(windows))]
    command("/usr/bin/curl")
}

/// 用于版本号和安装目录等小体积输出；探测超时后结束子进程。
pub(crate) fn output_with_timeout(mut command: Command, timeout: Duration) -> Option<Output> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return child.wait_with_output().ok(),
            Ok(None) if started.elapsed() < timeout => {
                std::thread::sleep(Duration::from_millis(50));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

/// 服务控制命令只等待退出状态，不继承终端或输出管道，避免守护进程占用管道。
pub(crate) fn status_with_timeout(
    mut command: Command,
    timeout: Duration,
) -> Result<ExitStatus, String> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("无法启动命令：{error}"))?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) if started.elapsed() < timeout => {
                std::thread::sleep(Duration::from_millis(50));
            }
            result => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(match result {
                    Err(error) => format!("无法等待命令结束：{error}"),
                    _ => format!("命令执行超过 {} 秒，已停止等待。", timeout.as_secs()),
                });
            }
        }
    }
}
