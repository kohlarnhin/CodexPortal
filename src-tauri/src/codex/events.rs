use super::paths::codex_home;
use super::version::codex_command;
use crate::logging;
use crate::process::{command, output_with_timeout};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager, State};
use uuid::Uuid;

const SOURCE: &str = "codex-events";

#[derive(Default)]
pub(crate) struct EventListenerState {
    bridge: Mutex<Option<EventBridge>>,
    epoch: Arc<AtomicU64>,
    switching: Arc<AtomicBool>,
}

struct EventBridge {
    url: String,
    stopped: Arc<AtomicBool>,
}

struct ConnectionGuard(Arc<AtomicBool>);

impl Drop for ConnectionGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

// 浏览器原生 WebSocket 负责握手和消息帧；本地桥只转发到 Codex 已有的控制入口。
// 每次启动使用随机路径，并限制 Origin，避免向其他本地网页开放 daemon 接口。
#[tauri::command]
pub(crate) fn get_codex_event_url(
    app: tauri::AppHandle,
    state: State<'_, EventListenerState>,
) -> Result<String, String> {
    let mut bridge = state.bridge.lock().map_err(|_| "事件监听状态不可用")?;
    if let Some(existing) = bridge.as_ref() {
        return Ok(existing.url.clone());
    }
    // 提前确认 CLI 可用；不启动、重启或安装 daemon。
    let _ = codex_command()?;
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|_| "无法建立本地事件连接")?;
    listener
        .set_nonblocking(true)
        .map_err(|_| "无法配置本地事件连接")?;
    let port = listener
        .local_addr()
        .map_err(|_| "无法获取本地事件端口")?
        .port();
    let route = format!("/{}", Uuid::new_v4());
    let url = format!("ws://127.0.0.1:{port}{route}");
    let stopped = Arc::new(AtomicBool::new(false));
    let worker_stop = stopped.clone();
    let active = Arc::new(AtomicBool::new(false));
    let mut origins = vec![
        "tauri://localhost".to_string(),
        "http://tauri.localhost".to_string(),
        "https://tauri.localhost".to_string(),
        // 兼容将自定义协议视为 opaque origin 的 WebView；随机路径仍必须匹配。
        "null".to_string(),
    ];
    if let Some(dev_url) = &app.config().build.dev_url {
        origins.push(dev_url.origin().ascii_serialization());
    }
    let epoch = state.epoch.clone();
    let switching = state.switching.clone();

    thread::spawn(move || {
        while !worker_stop.load(Ordering::Acquire) {
            match listener.accept() {
                Ok((stream, _)) => {
                    if active.swap(true, Ordering::AcqRel) {
                        let _ = stream.shutdown(Shutdown::Both);
                        continue;
                    }
                    let guard = ConnectionGuard(active.clone());
                    let stopped = worker_stop.clone();
                    let route = route.clone();
                    let origins = origins.clone();
                    let epoch = epoch.clone();
                    let switching = switching.clone();
                    thread::spawn(move || {
                        let _guard = guard;
                        let _ = forward_connection(stream, &route, &origins, stopped, epoch, switching);
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(100));
                }
                Err(_) => thread::sleep(Duration::from_secs(1)),
            }
        }
    });
    *bridge = Some(EventBridge {
        url: url.clone(),
        stopped,
    });
    Ok(url)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EventContext {
    account_id: Option<String>,
    epoch: u64,
    switching: bool,
}

#[tauri::command]
pub(crate) fn get_codex_event_context(
    app: tauri::AppHandle, state: State<'_, EventListenerState>,
) -> Result<EventContext, String> {
    let accounts = app.state::<crate::state::AppState>();
    let db = accounts.db.lock().map_err(|_| "账号状态不可用")?;
    let account_id = db.query_row("SELECT id FROM accounts WHERE is_active = 1 LIMIT 1", [], |row| row.get(0)).ok();
    Ok(EventContext { account_id, epoch: state.epoch.load(Ordering::Acquire), switching: state.switching.load(Ordering::Acquire) })
}

#[tauri::command]
pub(crate) fn save_codex_live_usage(
    app: tauri::AppHandle,
    state: State<'_, EventListenerState>,
    accounts: State<'_, crate::state::AppState>,
    epoch: u64,
    account_id: String,
    mut usage: crate::accounts::usage::AccountUsage,
) -> Result<(), String> {
    let db = accounts.db.lock().map_err(|_| "账号状态不可用")?;
    // 与账号切换共用数据库锁；旧连接的迟到数据不能写入新账号。
    if state.epoch.load(Ordering::Acquire) != epoch || state.switching.load(Ordering::Acquire) { return Ok(()); }
    for window in [&mut usage.primary, &mut usage.secondary].into_iter().flatten() {
        window.used_percent = window.used_percent.filter(|used| used.is_finite() && *used >= 0.0);
        window.window_minutes = window.window_minutes.filter(|minutes| *minutes > 0);
        window.resets_at = window.resets_at.filter(|timestamp| *timestamp > 0);
    }
    usage.synced_at = chrono::Utc::now().to_rfc3339();
    usage.request_started_at = None;
    usage.plan_type = None;
    let json = serde_json::to_string(&usage).map_err(|_| "额度缓存保存失败")?;
    let next = crate::accounts::usage::compute_next_refresh_at(&usage, chrono::Utc::now()).to_rfc3339();
    let plan = crate::accounts::usage::derive_plan_type_from_usage(&usage);
    let changed = db.execute(
        "UPDATE accounts SET usage_json = ?1, usage_updated_at = ?2, next_refresh_at = ?4, plan_type = COALESCE(?5, plan_type) WHERE id = ?3 AND is_active = 1",
        rusqlite::params![json, usage.synced_at, account_id, next, plan],
    ).map_err(|_| "额度缓存保存失败")?;
    if changed > 0 {
        // 与额度缓存一起更新决策快照；切换提交时不会读到上一条推送。
        crate::accounts::auto_switch::schedule(app.clone(), account_id.clone(), epoch, usage);
    }
    drop(db);
    if changed > 0 {
        let _ = app.emit("usage-updated", crate::accounts::usage::AccountRefreshEvent { account_id });
    }
    Ok(())
}

pub(crate) fn account_epoch_is_current(app: &tauri::AppHandle, epoch: u64) -> bool {
    app.try_state::<EventListenerState>().is_some_and(|state| {
        state.epoch.load(Ordering::Acquire) == epoch && !state.switching.load(Ordering::Acquire)
    })
}

pub(crate) fn pause_for_account_switch(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<EventListenerState>() {
        state.switching.store(true, Ordering::Release);
        state.epoch.fetch_add(1, Ordering::AcqRel);
    }
}

pub(crate) fn resume_after_account_switch(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<EventListenerState>() {
        state.switching.store(false, Ordering::Release);
        if let Ok(context) = get_codex_event_context(app.clone(), state) {
            let _ = app.emit("codex-account-context", context);
        }
    }
}

fn forward_connection(
    mut stream: TcpStream,
    route: &str,
    origins: &[String],
    stopped: Arc<AtomicBool>,
    account_epoch: Arc<AtomicU64>,
    switching: Arc<AtomicBool>,
) -> Result<(), ()> {
    if switching.load(Ordering::Acquire) { return Err(()); }
    let epoch = account_epoch.load(Ordering::Acquire);
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .map_err(|_| ())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(3)))
        .map_err(|_| ())?;
    let mut request = Vec::new();
    let header_end = loop {
        let mut chunk = [0; 2048];
        let length = stream.read(&mut chunk).map_err(|_| ())?;
        if length == 0 || request.len() + length > 16 * 1024 {
            return Err(());
        }
        request.extend_from_slice(&chunk[..length]);
        if let Some(index) = request.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
            break index + 4;
        }
    };
    let header = std::str::from_utf8(&request[..header_end]).map_err(|_| ())?;
    let mut lines = header.split("\r\n");
    let expected_request = format!("GET {route} HTTP/1.1");
    if lines.next() != Some(expected_request.as_str()) {
        return Err(());
    }
    let fields: Vec<(&str, &str)> = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| (name.trim(), value.trim()))
        .collect();
    let origin = fields
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("origin"))
        .map(|(_, value)| *value);
    let upgrade = fields
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("upgrade"))
        .map(|(_, value)| *value);
    let authorized = origin.map(|value| origins.iter().any(|allowed| allowed == value)).unwrap_or(false);
    if !authorized || !upgrade
            .map(|value| value.eq_ignore_ascii_case("websocket"))
            .unwrap_or(false)
    {
        return Err(());
    }
    // 随机路径和网页 Origin 只由桥验证，不传给 Codex。
    let mut forwarded = String::from("GET / HTTP/1.1\r\nHost: localhost\r\n");
    for (name, value) in fields {
        if !name.eq_ignore_ascii_case("host") && !name.eq_ignore_ascii_case("origin")
            && !name.eq_ignore_ascii_case("authorization") && !name.eq_ignore_ascii_case("sec-websocket-extensions") {
            forwarded.push_str(&format!("{name}: {value}\r\n"));
        }
    }
    forwarded.push_str("\r\n");

    if switching.load(Ordering::Acquire) || account_epoch.load(Ordering::Acquire) != epoch { return Err(()); }
    let mut command = event_proxy_command()?;
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = command.spawn().map_err(|_| ())?;
    let result = (|| -> Result<(), ()> {
        let mut input = child.stdin.take().ok_or(())?;
        let mut output = child.stdout.take().ok_or(())?;
        let finished = Arc::new(AtomicBool::new(false));
        input.write_all(forwarded.as_bytes()).map_err(|_| ())?;
        input.write_all(&request[header_end..]).map_err(|_| ())?;
        stream
            .set_read_timeout(Some(Duration::from_millis(250)))
            .map_err(|_| ())?;
        let mut outgoing = stream.try_clone().map_err(|_| ())?;
        let outgoing_finished = finished.clone();
        let output_worker = thread::spawn(move || {
            let _ = std::io::copy(&mut output, &mut outgoing);
            outgoing_finished.store(true, Ordering::Release);
            let _ = outgoing.shutdown(Shutdown::Both);
        });
        let mut buffer = [0; 8192];
        while !stopped.load(Ordering::Acquire) && !finished.load(Ordering::Acquire)
            && !switching.load(Ordering::Acquire) && account_epoch.load(Ordering::Acquire) == epoch {
            match stream.read(&mut buffer) {
                Ok(0) => break,
                Ok(length) => {
                    if input.write_all(&buffer[..length]).is_err() {
                        break;
                    }
                }
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) => {}
                Err(_) => break,
            }
        }
        // 关闭客户端和代理输入，结束的仅是本应用创建的 proxy，不控制 daemon。
        let _ = stream.shutdown(Shutdown::Both);
        drop(input);
        let deadline = Instant::now() + Duration::from_secs(2);
        while matches!(child.try_wait(), Ok(None)) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(50));
        }
        if matches!(child.try_wait(), Ok(None)) {
            let _ = child.kill();
        }
        let _ = child.wait();
        // 输出线程随管道关闭退出；不等待共享 daemon 的生命周期。
        drop(output_worker);
        Ok(())
    })();
    if result.is_err() {
        let _ = child.kill();
        let _ = child.wait();
    }
    result
}

fn event_proxy_command() -> Result<Command, ()> {
    let home = codex_home().map_err(|_| ())?;
    let mut inspect = codex_command().map_err(|_| ())?;
    inspect
        .args(["app-server", "daemon", "version"])
        .env("CODEX_HOME", &home);
    let output = output_with_timeout(inspect, Duration::from_secs(5)).ok_or(())?;
    if !output.status.success() {
        return Err(());
    }
    let metadata: serde_json::Value = serde_json::from_slice(&output.stdout).map_err(|_| ())?;
    if metadata.get("status").and_then(serde_json::Value::as_str) != Some("running") {
        return Err(());
    }
    let socket = metadata
        .get("socketPath")
        .and_then(serde_json::Value::as_str)
        .ok_or(())?;
    // 使用运行中 daemon 的原生 CLI，避免 npm 启动器留下代理子进程，也兼容版本差异。
    let executable = metadata
        .get("managedCodexPath")
        .and_then(serde_json::Value::as_str)
        .ok_or(())?;
    if !std::path::Path::new(executable).is_file() {
        return Err(());
    }
    let mut proxy = command(executable);
    proxy
        .args(["app-server", "proxy", "--sock", socket])
        .env("CODEX_HOME", home);
    Ok(proxy)
}

pub(crate) fn stop_event_listener(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<EventListenerState>() {
        if let Ok(bridge) = state.bridge.lock() {
            if let Some(bridge) = bridge.as_ref() { bridge.stopped.store(true, Ordering::Release); }
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct QuotaWindow {
    used_percent: Option<f64>,
    window_duration_mins: Option<i64>,
    resets_at: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ExhaustionReason {
    UsageLimitExceeded,
    WindowFull,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum QuotaStatus {
    RateLimitReached,
    WorkspaceOwnerCreditsDepleted,
    WorkspaceMemberCreditsDepleted,
    WorkspaceOwnerUsageLimitReached,
    WorkspaceMemberUsageLimitReached,
    Unknown,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SubscriptionFailureReason {
    Timeout,
    ThreadClosing,
    ThreadUnavailable,
    Rejected,
    InvalidResponse,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum ListenerReport {
    Connected,
    Disconnected,
    ConnectionFailed,
    InitializationFailed,
    InitialReadFailed,
    QuotaCacheFailed,
    ThreadDiscoveryFailed,
    ThreadSubscriptions {
        active: u32,
        subscribed: u32,
    },
    ThreadIdleReleased {
        count: u32,
    },
    ThreadSubscriptionFailed {
        count: u32,
        reason: SubscriptionFailureReason,
        code: Option<i64>,
    },
    ThreadUnsubscriptionFailed {
        count: u32,
        reason: SubscriptionFailureReason,
        code: Option<i64>,
    },
    RateLimits {
        pushed: bool,
        #[serde(default)]
        manual: bool,
        primary: Option<QuotaWindow>,
        secondary: Option<QuotaWindow>,
    },
    QuotaExhausted {
        reason: ExhaustionReason,
    },
    QuotaStatus {
        status: Option<QuotaStatus>,
        #[serde(rename = "spendControlReached")]
        spend_control_reached: Option<bool>,
    },
}

fn format_window(label: &str, window: Option<QuotaWindow>) -> Option<String> {
    let window = window?;
    let used = window
        .used_percent
        .filter(|used| used.is_finite() && *used >= 0.0)?;
    let remaining = (100.0 - used).clamp(0.0, 100.0);
    let duration = window
        .window_duration_mins
        .filter(|minutes| *minutes > 0)
        .map(|minutes| {
            if minutes % 60 == 0 {
                format!("{} 小时", minutes / 60)
            } else {
                format!("{minutes} 分钟")
            }
        });
    let reset = window
        .resets_at
        .and_then(|timestamp| chrono::DateTime::from_timestamp(timestamp, 0))
        .map(|date| date.with_timezone(&chrono::Local).format("%m-%d %H:%M").to_string());
    let mut message = format!("{label}已用 {used:.1}%，剩余 {remaining:.1}%");
    if let Some(duration) = duration {
        message.push_str(&format!("（{duration}额度）"));
    }
    if let Some(reset) = reset {
        message.push_str(&format!("，{reset} 重置"));
    }
    Some(message)
}

// 只接收结构化状态与额度数字，绝不把完整 RPC、账号信息或错误响应写入日志。
#[tauri::command]
pub(crate) fn report_codex_listener_event(report: ListenerReport) {
    match report {
        ListenerReport::Connected => {
            logging::info(SOURCE, "Codex app-server 监听已连接，正在发现活跃会话并订阅额度事件。")
        }
        ListenerReport::Disconnected => {
            logging::warn(SOURCE, "Codex 额度查询连接已断开，正在自动重连。")
        }
        ListenerReport::ConnectionFailed => logging::warn(
            SOURCE,
            "Codex 额度事件连接失败，将自动重试；请确认已有 daemon 正在运行。",
        ),
        ListenerReport::InitializationFailed => {
            logging::warn(SOURCE, "Codex 额度事件初始化失败，将自动重试。")
        }
        ListenerReport::InitialReadFailed => {
            logging::warn(SOURCE, "主动读取 Codex 额度失败；会话额度推送仍可更新展示。")
        }
        ListenerReport::QuotaCacheFailed => {
            logging::warn(SOURCE, "实时额度已更新展示，但账号额度缓存保存失败。")
        }
        ListenerReport::ThreadDiscoveryFailed => {
            logging::warn(SOURCE, "刷新活跃会话信息失败，将自动重试；可在当前账号页面手动刷新。")
        }
        ListenerReport::ThreadSubscriptions { active, subscribed } => {
            logging::info(SOURCE, format!("当前有 {active} 个活跃会话，已订阅 {subscribed} 个会话的额度事件。"));
        }
        ListenerReport::ThreadIdleReleased { count } => {
            logging::info(SOURCE, format!("{count} 个会话已空闲 5 分钟，已暂停额度订阅；有新任务时自动恢复。"));
        }
        ListenerReport::ThreadSubscriptionFailed { count, reason, code } => {
            let reason = match reason {
                SubscriptionFailureReason::Timeout => "订阅请求超时",
                SubscriptionFailureReason::ThreadClosing => "会话正在关闭",
                SubscriptionFailureReason::ThreadUnavailable => "会话已关闭或暂不可用",
                SubscriptionFailureReason::Rejected => "Codex 拒绝了订阅请求",
                SubscriptionFailureReason::InvalidResponse => "未收到有效的订阅响应",
            };
            let code = code.map(|value| format!("（RPC 错误码 {value}）")).unwrap_or_default();
            logging::warn(SOURCE, format!("有 {count} 个会话监听暂未成功：{reason}{code}；仍在使用的会话将自动重试。"));
        }
        ListenerReport::ThreadUnsubscriptionFailed { count, reason, code } => {
            let reason = match reason {
                SubscriptionFailureReason::Timeout => "退订请求超时",
                SubscriptionFailureReason::ThreadClosing => "会话正在关闭",
                SubscriptionFailureReason::ThreadUnavailable => "会话已关闭或暂不可用",
                SubscriptionFailureReason::Rejected => "Codex 拒绝了退订请求",
                SubscriptionFailureReason::InvalidResponse => "未收到有效的退订响应",
            };
            let code = code.map(|value| format!("（RPC 错误码 {value}）")).unwrap_or_default();
            logging::warn(SOURCE, format!("有 {count} 个空闲会话退订暂未完成：{reason}{code}；将自动重试。"));
        }
        ListenerReport::QuotaExhausted { reason } => {
            let message = match reason {
                ExhaustionReason::UsageLimitExceeded => {
                    "额度已用尽：监听到 UsageLimitExceeded，Codex 报告相关对话请求受到用量限制。"
                }
                ExhaustionReason::WindowFull => {
                    "额度上限提示：至少一个额度窗口显示已用 100% 或以上，请查看额度重置时间。"
                }
            };
            logging::warn(SOURCE, message);
        }
        ListenerReport::QuotaStatus { status, spend_control_reached } => {
            let status = match status {
                Some(QuotaStatus::RateLimitReached) => "窗口限额（rate_limit_reached）",
                Some(QuotaStatus::WorkspaceOwnerCreditsDepleted) => "工作区所有者积分耗尽（workspace_owner_credits_depleted）",
                Some(QuotaStatus::WorkspaceMemberCreditsDepleted) => "工作区成员积分耗尽（workspace_member_credits_depleted）",
                Some(QuotaStatus::WorkspaceOwnerUsageLimitReached) => "工作区所有者用量限制（workspace_owner_usage_limit_reached）",
                Some(QuotaStatus::WorkspaceMemberUsageLimitReached) => "工作区成员用量限制（workspace_member_usage_limit_reached）",
                Some(QuotaStatus::Unknown) => "未识别的状态",
                None => "未返回",
            };
            let spend_control = match spend_control_reached {
                Some(true) => "接口标记已达到",
                Some(false) => "接口标记未达到",
                None => "未返回",
            };
            logging::info(SOURCE, format!("额度状态提示：接口类型为 {status}；支出控制：{spend_control}。此标记单独记录，是否耗尽请结合窗口用量和实际请求错误判断。"));
        }
        ListenerReport::RateLimits { pushed, manual, primary, secondary } => {
            let windows: Vec<String> = [
                format_window("短周期", primary),
                format_window("长周期", secondary),
            ]
            .into_iter()
            .flatten()
            .collect();
            let prefix = if pushed { "监听到额度事件" } else if manual { "手动读取额度" } else { "初始读取额度" };
            if windows.is_empty() {
                logging::info(SOURCE, format!("{prefix}：当前未返回可识别的窗口额度。"));
            } else {
                logging::info(SOURCE, format!("{prefix}：{}。", windows.join("；")));
            }
        }
    }
}
