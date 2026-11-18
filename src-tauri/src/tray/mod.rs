mod icon;
mod view;

use crate::state::AppState;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Emitter, Listener, Manager, State};
use view::{Snapshot, TrayMenu};
pub(crate) use view::display_name;

const TRAY_PREFERENCE_KEY: &str = "tray_enabled";

#[derive(Clone, Serialize)]
pub(crate) struct TraySettings {
    enabled: bool,
    error: Option<String>,
}

#[derive(Clone, Serialize)]
pub(crate) struct TrayIconState {
    remaining: Option<u8>,
    revision: u64,
    wide: bool,
}

#[derive(Deserialize)]
pub(crate) struct TrayIconPixels {
    revision: u64,
    width: u32,
    height: u32,
    rgba: Vec<u8>,
}

enum Command {
    Refresh(RefreshRun),
    EmailMasking(bool),
    GetSettings(Sender<TraySettings>),
    SetEnabled(bool, Sender<TraySettings>),
    GetIconState(Sender<TrayIconState>),
    SetIcon(TrayIconPixels),
}

pub(crate) struct TrayState {
    sender: Sender<Command>,
    enabled: AtomicBool,
    refresh_pending: AtomicBool,
    next_refresh: Mutex<Option<Instant>>,
}

struct RefreshRun {
    app: AppHandle,
    failed: bool,
    owns_slot: bool,
    preserve_retry: bool,
}

impl Drop for RefreshRun {
    fn drop(&mut self) {
        let state = self.app.state::<TrayState>();
        let mut next = state.next_refresh.lock().unwrap_or_else(|error| error.into_inner());
        if !self.preserve_retry { *next = self.failed.then(|| Instant::now() + Duration::from_secs(60)); }
        if self.owns_slot { state.refresh_pending.store(false, Ordering::Release); }
    }
}

/// 巡检与真实变更共用一个刷新槽位，慢刷新期间不积压命令。
pub(crate) fn request_refresh(app: &AppHandle) {
    let Some(state) = app.try_state::<TrayState>() else { return };
    let Ok(next) = state.next_refresh.try_lock() else { return };
    if next.is_some_and(|at| at > Instant::now()) { return; }
    if state.refresh_pending.swap(true, Ordering::AcqRel) { return; }
    drop(next);
    let _ = state.sender.send(Command::Refresh(RefreshRun {
        app: app.clone(), failed: true, owns_slot: true, preserve_retry: false,
    }));
}

pub(crate) fn is_enabled(app: &AppHandle) -> bool {
    app.try_state::<TrayState>().is_some_and(|state| state.enabled.load(Ordering::Acquire))
}

pub(crate) fn start(app: AppHandle) -> Result<(), std::io::Error> {
    let (sender, receiver) = mpsc::channel();
    app.manage(TrayState {
        sender, enabled: AtomicBool::new(false), refresh_pending: AtomicBool::new(false),
        next_refresh: Mutex::new(None),
    });
    // 只注册一次菜单监听，反复开关托盘不会累积页面导航回调。
    app.on_menu_event(|app, event| {
        match event.id().as_ref() {
            view::SHOW_MAIN => crate::windows::show_main_window(app),
            view::DASHBOARD | view::QUOTA => crate::windows::show_page(app, "dashboard"),
            view::SETTINGS => crate::windows::show_page(app, "app-settings"),
            view::STATUS => crate::windows::show_page(app, "accounts"),
            view::QUIT => app.exit(0),
            id => {
                if id.starts_with(view::ACCOUNT_PREFIX) {
                    crate::windows::show_page(app, "accounts");
                }
            }
        }
    });
    for event in ["usage-updated", "accounts-updated", "session-sync-completed"] {
        let event_app = app.clone();
        app.listen(event, move |_| request_refresh(&event_app));
    }
    let worker_app = app.clone();
    std::thread::Builder::new().name("portal-tray".into()).spawn(move || {
        Worker {
            app: worker_app,
            enabled: false,
            masking: true,
            error: None,
            tray: None,
            menu: None,
            snapshot: None,
            icon_revision: 0,
            initialized: false,
        }.run(receiver);
    })?;
    request_refresh(&app);
    Ok(())
}

struct Worker {
    app: AppHandle,
    enabled: bool,
    masking: bool,
    error: Option<String>,
    tray: Option<TrayIcon>,
    menu: Option<TrayMenu>,
    snapshot: Option<Snapshot>,
    icon_revision: u64,
    initialized: bool,
}

impl Worker {
    fn run(&mut self, receiver: Receiver<Command>) {
        // 仅消费事件/命令，周期刷新由公共巡检请求；不再维护独立时钟。
        while let Ok(command) = receiver.recv() {
            match command {
                Command::GetIconState(reply) => { let _ = reply.send(self.icon_state()); }
                Command::SetIcon(pixels) => {
                    if pixels.revision == self.icon_revision {
                        if let Some(tray) = &self.tray {
                            let icon = tauri::image::Image::new_owned(pixels.rgba, pixels.width, pixels.height);
                            if tray.set_icon_with_as_template(Some(icon), false).is_err() {
                                self.error = Some("托盘图标更新失败，请重新开启托盘。".into());
                            }
                        }
                    }
                }
                Command::GetSettings(reply) => { let _ = reply.send(self.settings()); }
                Command::SetEnabled(enabled, reply) => {
                    let mut run = RefreshRun {
                        app: self.app.clone(), failed: true, owns_slot: false, preserve_retry: false,
                    };
                    let previous = self.enabled;
                    let result = self.apply_enabled(enabled).and_then(|()| self.save_preference(enabled));
                    run.failed = result.is_err();
                    if result.is_err() {
                        let _ = self.apply_enabled(previous);
                        self.error = Some("托盘设置保存失败，请重试。".into());
                    } else {
                        self.error = None;
                        self.initialized = true;
                    }
                    let _ = reply.send(self.settings());
                }
                Command::EmailMasking(masking) => {
                    self.masking = masking;
                    let mut run = RefreshRun {
                        app: self.app.clone(), failed: true, owns_slot: false, preserve_retry: false,
                    };
                    run.failed = self.refresh_if_enabled().is_err();
                }
                Command::Refresh(mut run) => {
                    let deferred = self.app.state::<TrayState>().next_refresh.lock()
                        .unwrap_or_else(|error| error.into_inner()).is_some_and(|at| at > Instant::now());
                    if deferred {
                        // 排队期间设置操作可能刚失败；保留它的固定重试期限。
                        run.preserve_retry = true;
                        continue;
                    }
                    let result = if self.initialized { self.refresh_if_enabled() } else { self.initialize() };
                    run.failed = result.is_err();
                }
            }
        }
    }

    fn initialize(&mut self) -> Result<(), String> {
        let result = self.read_preference().and_then(|enabled| self.apply_enabled(enabled));
        if result.is_err() {
            self.error = Some("托盘初始化失败，请重新开启托盘。".into());
        } else {
            self.initialized = true;
            self.error = None;
        }
        result
    }

    fn settings(&self) -> TraySettings {
        TraySettings { enabled: self.enabled, error: self.error.clone() }
    }

    fn icon_state(&self) -> TrayIconState {
        TrayIconState {
            remaining: self.snapshot.as_ref().and_then(Snapshot::remaining),
            revision: self.icon_revision,
            wide: cfg!(target_os = "macos"),
        }
    }

    fn read_preference(&self) -> Result<bool, String> {
        let state = self.app.state::<AppState>();
        let db = state.db.lock().map_err(|error| error.to_string())?;
        let saved: Option<String> = db.query_row(
            "SELECT content FROM configs WHERE key = ?1", params![TRAY_PREFERENCE_KEY], |row| row.get(0),
        ).optional().map_err(|error| error.to_string())?;
        saved.map(|value| serde_json::from_str(&value).map_err(|error| error.to_string())).unwrap_or(Ok(true))
    }

    fn save_preference(&self, enabled: bool) -> Result<(), String> {
        let state = self.app.state::<AppState>();
        let db = state.db.lock().map_err(|error| error.to_string())?;
        db.execute(
            "INSERT INTO configs (key, content) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET content = ?2",
            params![TRAY_PREFERENCE_KEY, enabled.to_string()],
        ).map_err(|error| error.to_string())?;
        Ok(())
    }

    fn apply_enabled(&mut self, enabled: bool) -> Result<(), String> {
        if enabled {
            self.refresh()?;
        }
        if let Some(tray) = &self.tray {
            tray.set_visible(enabled).map_err(|error| error.to_string())?;
        }
        self.enabled = enabled;
        self.app.state::<TrayState>().enabled.store(enabled, Ordering::Release);
        if enabled {
            // 重新开启时也补发，允许恢复之前未成功绘制的图标。
            let _ = self.app.emit_to("main", "tray-icon-state", self.icon_state());
        }
        Ok(())
    }

    fn refresh_if_enabled(&mut self) -> Result<(), String> {
        if self.enabled {
            if let Err(error) = self.refresh() {
                self.error = Some("托盘更新失败，请关闭后重新开启托盘。".into());
                return Err(error);
            }
        }
        Ok(())
    }

    fn refresh(&mut self) -> Result<(), String> {
        let snapshot = Snapshot::read(&self.app, self.masking)?;
        if self.snapshot.as_ref() == Some(&snapshot) {
            return Ok(());
        }
        let tooltip = snapshot.tooltip();
        let icon_changed = self.snapshot.is_none()
            || self.snapshot.as_ref().and_then(Snapshot::remaining) != snapshot.remaining();
        if let (Some(tray), Some(menu)) = (&self.tray, &mut self.menu) {
            menu.update(&self.app, &snapshot).map_err(|error| error.to_string())?;
            tray.set_tooltip(Some(&tooltip)).map_err(|error| error.to_string())?;
        } else {
            let menu = TrayMenu::new(&self.app, &snapshot).map_err(|error| error.to_string())?;
            let tray = TrayIconBuilder::with_id("portal-quota")
                .icon(icon::status_icon(snapshot.remaining()))
                .icon_as_template(false)
                .tooltip(&tooltip)
                .menu(&menu.menu)
                .show_menu_on_left_click(true)
                .build(&self.app)
                .map_err(|error| error.to_string())?;
            self.tray = Some(tray);
            self.menu = Some(menu);
        }
        self.snapshot = Some(snapshot);
        if icon_changed {
            self.icon_revision += 1;
            // 利用主窗口 Canvas 的系统字体绘制，避免像素字形；隐藏主窗口后仍接收更新。
            let _ = self.app.emit_to("main", "tray-icon-state", self.icon_state());
        }
        Ok(())
    }
}

async fn request_settings(
    app: AppHandle,
    enabled: Option<bool>,
) -> Result<TraySettings, String> {
    let sender = app.state::<TrayState>().sender.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (reply, receiver) = mpsc::channel();
        let command = match enabled {
            Some(value) => Command::SetEnabled(value, reply),
            None => Command::GetSettings(reply),
        };
        sender.send(command).map_err(|_| "托盘服务不可用".to_string())?;
        receiver.recv().map_err(|_| "托盘服务不可用".to_string())
    }).await.map_err(|_| "托盘设置读取失败".to_string())?
}

#[tauri::command]
pub(crate) async fn get_tray_settings(app: AppHandle) -> Result<TraySettings, String> {
    request_settings(app, None).await
}

#[tauri::command]
pub(crate) async fn set_tray_enabled(app: AppHandle, enabled: bool) -> Result<TraySettings, String> {
    request_settings(app, Some(enabled)).await
}

#[tauri::command]
pub(crate) fn set_tray_email_masking(state: State<'_, TrayState>, enabled: bool) -> Result<(), String> {
    state.sender.send(Command::EmailMasking(enabled)).map_err(|_| "托盘服务不可用".into())
}

#[tauri::command]
pub(crate) async fn get_tray_icon_state(app: AppHandle) -> Result<TrayIconState, String> {
    let sender = app.state::<TrayState>().sender.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (reply, receiver) = mpsc::channel();
        sender.send(Command::GetIconState(reply)).map_err(|_| "托盘服务不可用".to_string())?;
        receiver.recv().map_err(|_| "托盘服务不可用".to_string())
    }).await.map_err(|_| "托盘图标读取失败".to_string())?
}

#[tauri::command]
pub(crate) fn set_tray_icon(state: State<'_, TrayState>, pixels: TrayIconPixels) -> Result<(), String> {
    if pixels.width == 0 || pixels.height == 0 || pixels.width > 256 || pixels.height > 256
        || pixels.rgba.len() != pixels.width as usize * pixels.height as usize * 4 {
        return Err("托盘图标尺寸无效".into());
    }
    state.sender.send(Command::SetIcon(pixels)).map_err(|_| "托盘服务不可用".into())
}
