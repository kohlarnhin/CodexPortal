mod icon;
mod view;

use crate::state::AppState;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::time::Duration;
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Emitter, Listener, Manager, State};
use view::{Snapshot, TrayMenu};

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
    Refresh,
    EmailMasking(bool),
    GetSettings(Sender<TraySettings>),
    SetEnabled(bool, Sender<TraySettings>),
    Switch(String),
    SwitchFinished(bool),
    GetIconState(Sender<TrayIconState>),
    SetIcon(TrayIconPixels),
}

pub(crate) struct TrayState {
    sender: Sender<Command>,
    enabled: AtomicBool,
}

pub(crate) fn is_enabled(app: &AppHandle) -> bool {
    app.try_state::<TrayState>().is_some_and(|state| state.enabled.load(Ordering::Acquire))
}

pub(crate) fn start(app: AppHandle) -> Result<(), std::io::Error> {
    let (sender, receiver) = mpsc::channel();
    app.manage(TrayState { sender: sender.clone(), enabled: AtomicBool::new(false) });
    // 只注册一次菜单监听，反复开关托盘不会累积账号切换回调。
    app.on_menu_event(|app, event| {
        match event.id().as_ref() {
            view::SHOW_MAIN => crate::windows::show_main_window(app),
            view::DASHBOARD | view::QUOTA => crate::windows::show_page(app, "dashboard"),
            view::SETTINGS => crate::windows::show_page(app, "app-settings"),
            view::STATUS => crate::windows::show_page(app, "accounts"),
            view::QUIT => app.exit(0),
            id => {
                if let Some(account_id) = id.strip_prefix(view::SWITCH_PREFIX) {
                    let _ = app.state::<TrayState>().sender.send(Command::Switch(account_id.into()));
                }
            }
        }
    });
    for event in ["usage-updated", "accounts-updated", "session-sync-completed"] {
        let sender = sender.clone();
        app.listen(event, move |_| { let _ = sender.send(Command::Refresh); });
    }
    std::thread::Builder::new().name("portal-tray".into()).spawn(move || {
        Worker {
            app,
            enabled: false,
            masking: true,
            switching: false,
            switch_failed: false,
            error: None,
            tray: None,
            menu: None,
            snapshot: None,
            icon_revision: 0,
        }.run(receiver);
    })?;
    Ok(())
}

struct Worker {
    app: AppHandle,
    enabled: bool,
    masking: bool,
    switching: bool,
    switch_failed: bool,
    error: Option<String>,
    tray: Option<TrayIcon>,
    menu: Option<TrayMenu>,
    snapshot: Option<Snapshot>,
    icon_revision: u64,
}

impl Worker {
    fn run(&mut self, receiver: Receiver<Command>) {
        match self.read_preference().and_then(|enabled| self.apply_enabled(enabled)) {
            Ok(()) => {}
            Err(_) => self.error = Some("托盘初始化失败，请重新开启托盘。".into()),
        }
        loop {
            // 只读取本地缓存；补获账号新增/编辑，不额外请求额度接口或改变免打扰调度。
            let command = match receiver.recv_timeout(Duration::from_secs(5)) {
                Ok(command) => command,
                Err(RecvTimeoutError::Timeout) => Command::Refresh,
                Err(RecvTimeoutError::Disconnected) => break,
            };
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
                    let previous = self.enabled;
                    let result = self.apply_enabled(enabled).and_then(|()| self.save_preference(enabled));
                    if result.is_err() {
                        let _ = self.apply_enabled(previous);
                        self.error = Some("托盘设置保存失败，请重试。".into());
                    } else {
                        self.error = None;
                    }
                    let _ = reply.send(self.settings());
                }
                Command::EmailMasking(masking) => {
                    self.masking = masking;
                    self.refresh_if_enabled();
                }
                Command::Refresh => self.refresh_if_enabled(),
                Command::Switch(id) => self.switch_account(id),
                Command::SwitchFinished(success) => {
                    self.switching = false;
                    self.switch_failed = !success;
                    self.refresh_if_enabled();
                }
            }
        }
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

    fn refresh_if_enabled(&mut self) {
        if self.enabled && self.refresh().is_err() {
            self.error = Some("托盘更新失败，请关闭后重新开启托盘。".into());
        }
    }

    fn refresh(&mut self) -> Result<(), String> {
        let snapshot = Snapshot::read(&self.app, self.masking, self.switching, self.switch_failed)?;
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

    fn switch_account(&mut self, id: String) {
        if !self.enabled || self.switching {
            return;
        }
        let can_switch = self.snapshot.as_ref().is_some_and(|snapshot| snapshot.accounts.iter()
            .any(|account| account.id == id && account.can_activate && !account.active));
        if !can_switch {
            return;
        }
        self.switching = true;
        self.switch_failed = false;
        self.refresh_if_enabled();
        let app = self.app.clone();
        let sender = self.app.state::<TrayState>().sender.clone();
        // 复用主界面的认证续期、写入 auth.json 与账号归属事务；切换不阻塞托盘线程。
        tauri::async_runtime::spawn_blocking(move || {
            let result = tauri::async_runtime::block_on(crate::accounts::set_active_account(
                app.clone(), app.state::<AppState>(), id,
            ));
            let _ = sender.send(Command::SwitchFinished(result.is_ok()));
        });
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
