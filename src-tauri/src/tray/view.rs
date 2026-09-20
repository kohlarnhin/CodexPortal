use crate::accounts::{read_accounts, Account};
use crate::state::AppState;
use chrono::{DateTime, Local};
use tauri::menu::{IconMenuItem, Menu, MenuItem, NativeIcon, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager};
use super::icon::{action_icon, ActionIcon};

pub(super) const SWITCH_PREFIX: &str = "portal-tray-account:";
pub(super) const SHOW_MAIN: &str = "portal-tray-main";
pub(super) const DASHBOARD: &str = "portal-tray-dashboard";
pub(super) const QUOTA: &str = "portal-tray-quota";
pub(super) const SETTINGS: &str = "portal-tray-settings";
pub(super) const STATUS: &str = "portal-tray-status";
pub(super) const QUIT: &str = "portal-tray-quit";

#[derive(PartialEq, Eq)]
pub(super) struct TrayAccount {
    pub id: String,
    label: String,
    pub active: bool,
    pub can_activate: bool,
    remaining: Option<u8>,
    resets_at: Option<i64>,
    reset_due: bool,
}

#[derive(Default, PartialEq, Eq)]
pub(super) struct Snapshot {
    pub accounts: Vec<TrayAccount>,
    pub switching: bool,
    pub switch_failed: bool,
    local_day: String,
    dark_menu: bool,
}

fn display_name(name: &str, masking: bool) -> String {
    let name = name.trim();
    if masking {
        if let Some((local, domain)) = name.rsplit_once('@') {
            let letters: Vec<_> = local.chars().collect();
            return match letters.as_slice() {
                [] => name.to_string(),
                [_] => format!("*@{domain}"),
                [first, _] => format!("{first}*@{domain}"),
                [first, .., last] => format!("{first}***{last}@{domain}"),
            };
        }
    }
    name.to_string()
}

fn account_snapshot(account: Account, masking: bool) -> TrayAccount {
    let primary = account.usage.as_ref().and_then(|usage| usage.primary.as_ref());
    let remaining = primary
        .and_then(|window| window.used_percent)
        .filter(|used| used.is_finite())
        .map(|used| (100.0 - used).clamp(0.0, 100.0).round() as u8);
    let name = display_name(&account.name, masking);
    // 托盘只保留展示所需字段，不保留任何认证凭证。
    let label = name.chars().take(36).collect::<String>();
    TrayAccount {
        id: account.id,
        label,
        active: account.is_active,
        can_activate: account.can_activate,
        remaining,
        resets_at: primary.and_then(|window| window.resets_at),
        reset_due: primary.and_then(|window| window.resets_at).is_some_and(|time| time <= chrono::Utc::now().timestamp()),
    }
}

impl Snapshot {
    pub fn read(app: &AppHandle, masking: bool, switching: bool, switch_failed: bool) -> Result<Self, String> {
        let state = app.state::<AppState>();
        let accounts = {
            let db = state.db.lock().map_err(|error| error.to_string())?;
            read_accounts(&db)?.accounts
        };
        Ok(Self {
            accounts: accounts.into_iter()
                .map(|account| account_snapshot(account, masking))
                .collect(),
            switching,
            switch_failed,
            local_day: Local::now().format("%Y-%m-%d").to_string(),
            dark_menu: cfg!(target_os = "macos") && app.get_webview_window("main")
                .and_then(|window| window.theme().ok()).is_some_and(|theme| theme == tauri::Theme::Dark),
        })
    }

    fn active(&self) -> Option<&TrayAccount> {
        self.accounts.iter().find(|account| account.active)
    }

    pub fn remaining(&self) -> Option<u8> {
        self.active().and_then(|account| account.remaining)
    }

    pub fn tooltip(&self) -> String {
        match self.active() {
            Some(account) => format!("Codex Portal · {}\n第一窗口{}", account.label, quota_label(account.remaining)),
            None => "Codex Portal · 未启用账号".into(),
        }
    }
}

fn quota_label(remaining: Option<u8>) -> String {
    remaining.map(|value| format!("剩余 {value}%")).unwrap_or_else(|| "额度未知".into())
}

fn menu_text(text: &str) -> String {
    text.chars().filter(|character| !character.is_control()).collect::<String>().replace('&', "&&")
}

pub(super) struct TrayMenu {
    pub menu: Menu<tauri::Wry>,
    current: IconMenuItem<tauri::Wry>,
    quota: IconMenuItem<tauri::Wry>,
    reset: MenuItem<tauri::Wry>,
    status: MenuItem<tauri::Wry>,
    status_visible: bool,
    accounts: Submenu<tauri::Wry>,
    rows: Vec<(String, IconMenuItem<tauri::Wry>)>,
    show: IconMenuItem<tauri::Wry>,
    settings: IconMenuItem<tauri::Wry>,
    dark_menu: bool,
}

impl TrayMenu {
    pub fn new(app: &AppHandle, snapshot: &Snapshot) -> tauri::Result<Self> {
        let current = IconMenuItem::with_id_and_native_icon(app, DASHBOARD, "当前账号", true, Some(NativeIcon::User), None::<&str>)?;
        let quota = IconMenuItem::with_id(app, QUOTA, "第一窗口额度未知", true, Some(super::icon::status_icon(None)), None::<&str>)?;
        let reset = MenuItem::new(app, "重置时间未知", false, None::<&str>)?;
        let status = MenuItem::with_id(app, STATUS, "正在切换账号…", false, None::<&str>)?;
        let accounts = Submenu::new_with_native_icon(app, "切换账号", true, Some(NativeIcon::UserGroup))?;
        let show = IconMenuItem::with_id(app, SHOW_MAIN, "显示主界面", true, Some(action_icon(ActionIcon::Window, snapshot.dark_menu)), None::<&str>)?;
        let settings = IconMenuItem::with_id(app, SETTINGS, "设置…", true, Some(action_icon(ActionIcon::Settings, snapshot.dark_menu)), Some("CmdOrCtrl+,"))?;
        let quit = IconMenuItem::with_id_and_native_icon(app, QUIT, "退出 Codex Portal", true, Some(NativeIcon::StopProgress), Some("CmdOrCtrl+Q"))?;
        let menu = Menu::with_items(app, &[
            &quota, &reset,
            &PredefinedMenuItem::separator(app)?, &current, &accounts,
            &PredefinedMenuItem::separator(app)?, &show, &settings,
            &PredefinedMenuItem::separator(app)?, &quit,
        ])?;
        let mut result = Self {
            menu, current, quota, reset, status, status_visible: false, accounts, rows: Vec::new(),
            show, settings, dark_menu: snapshot.dark_menu,
        };
        result.update(app, snapshot)?;
        Ok(result)
    }

    pub fn update(&mut self, app: &AppHandle, snapshot: &Snapshot) -> tauri::Result<()> {
        if self.dark_menu != snapshot.dark_menu {
            self.show.set_icon(Some(action_icon(ActionIcon::Window, snapshot.dark_menu)))?;
            self.settings.set_icon(Some(action_icon(ActionIcon::Settings, snapshot.dark_menu)))?;
            self.dark_menu = snapshot.dark_menu;
        }
        self.current.set_text(menu_text(&snapshot.active().map(|account| account.label.clone())
            .unwrap_or_else(|| "添加或启用账号…".into())))?;
        self.quota.set_text(format!("第一窗口 · {}", quota_label(snapshot.remaining())))?;
        self.quota.set_icon(Some(super::icon::status_icon(snapshot.remaining())))?;
        let reset_time = snapshot.active().and_then(|account| account.resets_at)
            .and_then(|timestamp| DateTime::from_timestamp(timestamp, 0));
        let reset_label = match reset_time {
            Some(time) if time <= chrono::Utc::now() => "窗口已到期 · 等待额度更新".into(),
            Some(time) => {
                let local = time.with_timezone(&Local);
                if local.date_naive() == Local::now().date_naive() {
                    format!("今天 {} 重置", local.format("%H:%M"))
                } else {
                    format!("{} 重置", local.format("%m-%d %H:%M"))
                }
            }
            None => "重置时间未知".into(),
        };
        self.reset.set_text(reset_label)?;
        let show_status = snapshot.switching || snapshot.switch_failed;
        if show_status != self.status_visible {
            if show_status { self.menu.insert(&self.status, 2)?; }
            else { self.menu.remove(&self.status)?; }
            self.status_visible = show_status;
        }
        if show_status {
            self.status.set_text(if snapshot.switching { "正在切换账号…" } else { "切换失败 · 前往账号管理重试" })?;
            self.status.set_enabled(snapshot.switch_failed && !snapshot.switching)?;
        }
        self.accounts.set_enabled(!snapshot.accounts.is_empty())?;

        if !self.rows.iter().map(|(id, _)| id).eq(snapshot.accounts.iter().map(|account| &account.id)) {
            while self.accounts.remove_at(0)?.is_some() {}
            self.rows.clear();
            for account in &snapshot.accounts {
                let item = IconMenuItem::with_id(app, format!("{SWITCH_PREFIX}{}", account.id), "", false, None, None::<&str>)?;
                self.accounts.append(&item)?;
                self.rows.push((account.id.clone(), item));
            }
        }
        for (index, ((_, row), account)) in self.rows.iter().zip(&snapshot.accounts).enumerate() {
            let suffix = if account.active { " · 当前" } else if !account.can_activate { " · 需重新登录" } else { "" };
            row.set_text(menu_text(&format!("{}. {} · {}{suffix}", index + 1, account.label, quota_label(account.remaining))))?;
            row.set_icon(Some(super::icon::status_icon(account.remaining)))?;
            row.set_enabled(account.can_activate && !snapshot.switching)?;
        }
        Ok(())
    }
}
