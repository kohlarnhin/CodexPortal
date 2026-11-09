use super::paths::codex_home;
use super::version::{codex_executable_candidates, CodexExecutable};
use crate::process::output_with_timeout;
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

const PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const CONNECTION_BUDGET: Duration = Duration::from_secs(12);
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(3);
const DAEMON_NOT_RUNNING: &str = "共享 app-server 未运行";

struct AppServerProbe {
    engine: CodexExecutable,
    socket: Option<String>,
    managed_engine: Option<CodexExecutable>,
    running: bool,
    failure: Option<&'static str>,
}

pub(super) struct AppServerConnection {
    pub(super) input: Box<dyn Write + Send>,
    pub(super) output: Box<dyn Read + Send>,
    pub(super) response: Vec<u8>,
    pub(super) guard: AppServerGuard,
    pub(super) source: &'static str,
}

pub(super) enum AppServerGuard {
    #[cfg(unix)]
    Socket(std::os::unix::net::UnixStream),
    Proxy(Child),
}

impl Drop for AppServerGuard {
    fn drop(&mut self) {
        match self {
            #[cfg(unix)]
            Self::Socket(socket) => { let _ = socket.shutdown(std::net::Shutdown::Both); }
            Self::Proxy(child) => {
                // 只结束 Portal 自己创建的原生代理；不控制共享 app-server。
                let deadline = Instant::now() + Duration::from_secs(2);
                while matches!(child.try_wait(), Ok(None)) && Instant::now() < deadline {
                    thread::sleep(Duration::from_millis(50));
                }
                if !matches!(child.try_wait(), Ok(Some(_))) { let _ = child.kill(); }
                let _ = child.wait();
            }
        }
    }
}

fn probe_engine(engine: CodexExecutable, home: &Path) -> AppServerProbe {
    let mut probe = AppServerProbe {
        engine, socket: None, managed_engine: None, running: false, failure: None,
    };
    let mut inspect = probe.engine.command();
    inspect.args(["app-server", "daemon", "version"]).env("CODEX_HOME", home);
    let Some(output) = output_with_timeout(inspect, PROBE_TIMEOUT) else {
        probe.failure = Some("服务探测无法启动或已超时");
        return probe;
    };
    if !output.status.success() {
        // 仅归类固定的 CLI 错误，不记录可能包含账号或目录信息的输出正文。
        let text = [&output.stdout, &output.stderr].into_iter()
            .map(|bytes| String::from_utf8_lossy(bytes))
            .collect::<String>();
        probe.failure = Some(if text.contains("unrecognized subcommand") || text.contains("unexpected argument") {
            "不支持 daemon 查询命令"
        } else if text.contains("failed to connect to") {
            // daemon 未启动时控制入口不存在，version 查询以连接失败退出。
            DAEMON_NOT_RUNNING
        } else {
            "daemon 查询命令执行失败"
        });
        return probe;
    }
    let Ok(metadata) = serde_json::from_slice::<serde_json::Value>(&output.stdout) else {
        probe.failure = Some("服务信息格式异常");
        return probe;
    };
    probe.running = metadata.get("status").and_then(serde_json::Value::as_str) == Some("running");
    probe.socket = metadata.get("socketPath")
        .and_then(serde_json::Value::as_str)
        .filter(|path| !path.trim().is_empty())
        .map(str::to_string);
    probe.managed_engine = metadata.get("managedCodexPath")
        .and_then(serde_json::Value::as_str)
        .map(PathBuf::from)
        .filter(|path| path.is_absolute() && path.is_file())
        .map(|path| probe.engine.with_path(path));
    probe.failure = if !probe.running {
        Some("未报告运行中的共享服务")
    } else if probe.socket.is_none() {
        Some("服务信息缺少连接地址")
    } else {
        None
    };
    probe
}

fn discover_app_servers() -> Result<(PathBuf, Vec<AppServerProbe>), String> {
    let home = codex_home()?;
    let engines = codex_executable_candidates();
    if engines.is_empty() {
        return Err("未找到 Codex CLI 或 ChatGPT 桌面内置引擎，请检查安装位置。".into());
    }
    // 某个旧版或异常 CLI 不阻塞 ChatGPT 引擎的探测；候选顺序仍保持稳定。
    let probes = thread::scope(|scope| {
        let workers: Vec<_> = engines.into_iter().map(|engine| {
            let home = &home;
            scope.spawn(move || probe_engine(engine, home))
        }).collect();
        workers.into_iter().filter_map(|worker| worker.join().ok()).collect::<Vec<_>>()
    });
    if probes.is_empty() { return Err("Codex CLI 与 ChatGPT 桌面引擎的服务探测均未完成。".into()); }
    Ok((home, probes))
}

fn native_executable(path: &Path) -> bool {
    let mut magic = [0; 4];
    if File::open(path).and_then(|mut file| file.read_exact(&mut magic)).is_err() { return false; }
    magic.starts_with(b"MZ") || magic == *b"\x7fELF" || matches!(magic,
        [0xfe, 0xed, 0xfa, 0xce] | [0xce, 0xfa, 0xed, 0xfe] |
        [0xfe, 0xed, 0xfa, 0xcf] | [0xcf, 0xfa, 0xed, 0xfe] |
        [0xca, 0xfe, 0xba, 0xbe] | [0xbe, 0xba, 0xfe, 0xca] |
        [0xca, 0xfe, 0xba, 0xbf] | [0xbf, 0xba, 0xfe, 0xca])
}

fn native_proxy_candidates(engine: &CodexExecutable) -> Vec<CodexExecutable> {
    if native_executable(&engine.path) { return vec![engine.clone()]; }
    let (package, target) = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "x86_64") => ("@openai/codex-darwin-x64", "x86_64-apple-darwin"),
        ("macos", "aarch64") => ("@openai/codex-darwin-arm64", "aarch64-apple-darwin"),
        ("linux" | "android", "x86_64") => ("@openai/codex-linux-x64", "x86_64-unknown-linux-musl"),
        ("linux" | "android", "aarch64") => ("@openai/codex-linux-arm64", "aarch64-unknown-linux-musl"),
        ("windows", "x86_64") => ("@openai/codex-win32-x64", "x86_64-pc-windows-msvc"),
        ("windows", "aarch64") => ("@openai/codex-win32-arm64", "aarch64-pc-windows-msvc"),
        _ => return Vec::new(),
    };
    let Ok(path) = fs::canonicalize(&engine.path) else { return Vec::new() };
    let Some(parent) = path.parent() else { return Vec::new() };
    // npm 的 Unix 入口指向 bin/codex.js；Windows 的 cmd 入口与 node_modules 同级。
    let roots = parent.parent().map(Path::to_path_buf).into_iter()
        .chain(std::iter::once(parent.join("node_modules/@openai/codex")));
    let mut candidates = Vec::new();
    for root in roots {
        let is_codex_package = fs::read(root.join("package.json")).ok()
            .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
            .is_some_and(|metadata| metadata.get("name").and_then(serde_json::Value::as_str) == Some("@openai/codex"));
        if !is_codex_package { continue; }
        // 与官方 npm 启动器一致，优先解析平台依赖，再尝试旧版 vendor 布局。
        let vendors = root.ancestors()
            .map(|directory| directory.join("node_modules").join(package).join("vendor"))
            .chain(std::iter::once(root.join("vendor")));
        for vendor in vendors {
            let executable = vendor.join(target).join("bin")
                .join(if cfg!(windows) { "codex.exe" } else { "codex" });
            if native_executable(&executable) { candidates.push(engine.with_path(executable)); }
        }
    }
    candidates
}

fn read_upgrade_response(mut output: Box<dyn Read + Send>)
    -> Result<(Box<dyn Read + Send>, Vec<u8>), &'static str>
{
    let mut response = Vec::new();
    loop {
        let mut chunk = [0; 2048];
        let length = output.read(&mut chunk).map_err(|_| "读取服务握手失败")?;
        if length == 0 { return Err("服务连接已关闭，连接入口或 proxy 命令可能不兼容"); }
        response.extend_from_slice(&chunk[..length]);
        if let Some(index) = response.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
            if index + 4 > 16 * 1024 { return Err("服务握手格式异常"); }
            let line = response.split(|byte| *byte == b'\n').next().unwrap_or_default();
            let line = std::str::from_utf8(line).map_err(|_| "服务握手格式异常")?;
            let mut fields = line.split_whitespace();
            if !matches!(fields.next(), Some("HTTP/1.1" | "HTTP/1.0")) || fields.next() != Some("101") {
                return Err("服务拒绝 WebSocket 握手");
            }
            return Ok((output, response));
        }
        if response.len() >= 16 * 1024 { return Err("服务握手格式异常"); }
    }
}

fn handshake(
    mut input: Box<dyn Write + Send>, output: Box<dyn Read + Send>,
    guard: AppServerGuard, source: &'static str, request: &[u8], timeout: Duration,
) -> Result<AppServerConnection, &'static str> {
    if input.write_all(request).and_then(|_| input.flush()).is_err() {
        drop(input);
        drop(output);
        drop(guard);
        return Err("发送服务握手失败");
    }
    let (sender, receiver) = mpsc::sync_channel(1);
    thread::spawn(move || { let _ = sender.send(read_upgrade_response(output)); });
    match receiver.recv_timeout(timeout) {
        Ok(Ok((output, response))) => Ok(AppServerConnection { input, output, response, guard, source }),
        result => {
            let error = match result { Ok(Err(error)) => error, _ => "服务握手超时" };
            drop(input);
            drop(guard);
            Err(error)
        }
    }
}

fn connect_proxy(
    engine: &CodexExecutable, home: &Path, socket: Option<&str>,
    request: &[u8], timeout: Duration,
) -> Result<AppServerConnection, &'static str> {
    let mut command = engine.command();
    command.args(["app-server", "proxy"]).env("CODEX_HOME", home);
    if let Some(socket) = socket { command.args(["--sock", socket]); }
    command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    let child = command.spawn().map_err(|_| "无法启动服务代理")?;
    let mut guard = AppServerGuard::Proxy(child);
    let (input, output) = match &mut guard {
        AppServerGuard::Proxy(child) => (
            child.stdin.take().ok_or("服务代理输入不可用")?,
            child.stdout.take().ok_or("服务代理输出不可用")?,
        ),
        #[cfg(unix)]
        AppServerGuard::Socket(_) => return Err("服务代理状态异常"),
    };
    handshake(Box::new(input), Box::new(output), guard, engine.label(), request, timeout)
}

fn add_failure(failures: &mut Vec<String>, source: &str, reason: &str) {
    let message = format!("{source}：{reason}");
    if !failures.contains(&message) { failures.push(message); }
}

/// 接入实际可握手的已有服务；不因第一个 CLI 失败而放弃桌面端。
/// 共享控制地址去重，CLI 与 ChatGPT 共用服务时只维护一个监听。
pub(super) fn connect_app_server(
    request: &[u8], is_current: impl Fn() -> bool,
) -> Result<AppServerConnection, String> {
    let (home, probes) = discover_app_servers()?;
    let deadline = Instant::now() + CONNECTION_BUDGET;
    let mut failures = Vec::new();
    let mut sockets = Vec::new();
    let mut seen_sockets = HashSet::new();
    let mut native_engines = Vec::new();
    let mut seen_engines = HashSet::new();
    for (engine, probe) in probes.iter()
        .filter_map(|probe| probe.managed_engine.as_ref().map(|engine| (engine, probe)))
        .chain(probes.iter().map(|probe| (&probe.engine, probe)))
    {
        // daemon 查询失败时也能从 npm 安装解析原生引擎，保留默认 proxy 的回退机会；
        // 已确认控制入口不存在时，默认 proxy 只会连接同一地址，不再启动注定失败的代理。
        let default_proxy = probe.failure != Some(DAEMON_NOT_RUNNING);
        for engine in native_proxy_candidates(engine) {
            let path = fs::canonicalize(&engine.path).unwrap_or_else(|_| engine.path.clone());
            if seen_engines.insert(path) { native_engines.push((engine, default_proxy)); }
        }
    }
    for probe in &probes {
        if !is_current() { return Err("账号上下文已变化，等待重新连接。".into()); }
        if let Some(failure) = probe.failure { add_failure(&mut failures, probe.engine.label(), failure); }
        if let Some(socket) = probe.socket.as_deref() {
            if seen_sockets.insert(socket) { sockets.push((socket, &probe.engine)); }
        }
    }
    #[cfg(unix)]
    for (socket, engine) in &sockets {
        if !is_current() { return Err("账号上下文已变化，等待重新连接。".into()); }
        if Instant::now() < deadline {
            // 桌面端的已有 Unix 控制入口无需依赖 daemon 的托管路径或 proxy 子命令。
            match std::os::unix::net::UnixStream::connect(socket) {
                Ok(stream) => {
                    let timeout = HANDSHAKE_TIMEOUT.min(deadline.saturating_duration_since(Instant::now()));
                    let connection = (|| {
                        stream.set_write_timeout(Some(timeout)).map_err(|_| "无法配置服务连接")?;
                        let input = stream.try_clone().map_err(|_| "无法建立服务输入通道")?;
                        let output = stream.try_clone().map_err(|_| "无法建立服务输出通道")?;
                        handshake(Box::new(input), Box::new(output), AppServerGuard::Socket(stream),
                            engine.label(), request, timeout)
                    })();
                    match connection {
                        Ok(connection) => return Ok(connection),
                        Err(error) => add_failure(&mut failures, engine.label(), error),
                    }
                }
                Err(_) => add_failure(&mut failures, engine.label(), "无法连接服务控制地址"),
            }
        }
    }
    // 先遍历各控制地址，再尝试不同版本的代理，避免异常 CLI 地址耗尽桌面端的机会。
    for (engine, _) in &native_engines {
        for (socket, _) in &sockets {
            if !is_current() { return Err("账号上下文已变化，等待重新连接。".into()); }
            let timeout = HANDSHAKE_TIMEOUT.min(deadline.saturating_duration_since(Instant::now()));
            if timeout.is_zero() { break; }
            match connect_proxy(engine, &home, Some(socket), request, timeout) {
                Ok(connection) => return Ok(connection),
                Err(error) => add_failure(&mut failures, engine.label(), error),
            }
        }
    }
    // daemon 查询不可用的版本仍可能提供连接默认控制入口的 proxy。
    // 只运行原生引擎，避免 npm/批处理启动器留下代理子进程。
    for (engine, _) in native_engines.into_iter().filter(|(_, default_proxy)| *default_proxy) {
        if !is_current() { return Err("账号上下文已变化，等待重新连接。".into()); }
        let timeout = HANDSHAKE_TIMEOUT.min(deadline.saturating_duration_since(Instant::now()));
        if timeout.is_zero() { break; }
        match connect_proxy(&engine, &home, None, request, timeout) {
            Ok(connection) => return Ok(connection),
            Err(error) => add_failure(&mut failures, engine.label(), error),
        }
    }
    if Instant::now() >= deadline { failures.push("连接候选探测已超时".into()); }
    Err(format!("无法接入运行中的 app-server：{}。", failures.join("；")))
}

/// 先选择运行中服务的引擎，再回退到支持 restart 的 CLI 或 ChatGPT 引擎。
/// 能力探测只执行 --help；实际重启仍由调用者执行一次。
pub(super) fn app_server_restart_command() -> Result<Command, String> {
    let (home, probes) = discover_app_servers()?;
    let mut engines = Vec::new();
    let mut seen = HashSet::new();
    for engine in probes.iter().filter(|probe| probe.running)
        .filter_map(|probe| probe.managed_engine.as_ref())
        .chain(probes.iter().map(|probe| &probe.engine))
    {
        let path = fs::canonicalize(&engine.path).unwrap_or_else(|_| engine.path.clone());
        if seen.insert(path) { engines.push(engine); }
    }
    let supported = thread::scope(|scope| {
        let workers: Vec<_> = engines.iter().map(|engine| {
            let home = &home;
            scope.spawn(move || {
                let mut help = engine.command();
                help.args(["app-server", "daemon", "restart", "--help"]).env("CODEX_HOME", home);
                output_with_timeout(help, PROBE_TIMEOUT).map(|output| output.status.success()).unwrap_or(false)
            })
        }).collect();
        workers.into_iter().map(|worker| worker.join().unwrap_or(false)).collect::<Vec<_>>()
    });
    for (engine, supported) in engines.into_iter().zip(supported) {
        if supported {
            let mut command = engine.command();
            command.args(["app-server", "daemon", "restart"]).env("CODEX_HOME", &home);
            return Ok(command);
        }
    }
    Err("Codex CLI 与 ChatGPT 桌面内置引擎均不支持共享服务重启命令。".into())
}
