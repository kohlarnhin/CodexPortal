mod accounts;
mod auth;
mod codex;
mod db;
mod http;
mod process;
mod sessions;
mod skills;
mod state;
mod time;
mod updates;

#[cfg(test)]
mod test_support;

use crate::accounts::periods::ensure_account_period_on_startup;
use crate::accounts::scheduler::start_usage_scheduler;
use crate::db::init_db;
use crate::sessions::sync::start_session_sync_scheduler;
use crate::state::{AppState, OAuthSession};
use rusqlite::Connection;
use std::collections::HashSet;
use std::fs;
use std::sync::Mutex;
use tauri::Manager;

#[cfg(desktop)]
fn show_main_window<R: tauri::Runtime>(app_handle: &tauri::AppHandle<R>) {
    #[cfg(target_os = "macos")]
    let _ = app_handle.show();

    if let Some(window) = app_handle.get_webview_window("main") {
        // 启动和从 Dock 重新打开时，恢复适合展示两个账号的默认窗口尺寸。
        let _ = window.unmaximize();
        if let Some(config) = app_handle
            .config()
            .app
            .windows
            .iter()
            .find(|config| config.label == window.label())
        {
            let _ = window.set_size(tauri::LogicalSize::new(config.width, config.height));
        }
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .on_window_event(|_window, _event| {
            // macOS 可通过 Dock 恢复窗口；Windows 使用原生关闭退出行为。
            #[cfg(target_os = "macos")]
            if let tauri::WindowEvent::CloseRequested { api, .. } = _event {
                let _ = _window.hide();
                api.prevent_close();
            }
        })
        .setup(|app| {
            #[cfg(desktop)]
            {
                let updater = tauri_plugin_updater::Builder::new();
                #[cfg(windows)]
                let updater =
                    updater.target(format!("windows-{}-portable", std::env::consts::ARCH));
                app.handle().plugin(updater.build())?;
            }

            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");
            fs::create_dir_all(&app_data_dir).expect("Failed to create app data directory");

            let db_path = app_data_dir.join("database.sqlite");
            let conn = Connection::open(&db_path).expect("Failed to open SQLite database");

            init_db(&conn).expect("Failed to initialize database schema");

            app.manage(AppState {
                db: Mutex::new(conn),
                refreshing: Mutex::new(HashSet::new()),
                oauth: Mutex::new(OAuthSession::default()),
                syncing_sessions: Mutex::new(false),
            });

            start_usage_scheduler(app.handle().clone());
            start_session_sync_scheduler(app.handle().clone());

            // 账号库为空时，后台自动从 ~/.codex/auth.json 导入账号（异步，失败静默）。
            {
                let import_app = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let state = import_app.state::<AppState>();
                    match accounts::import_account_from_auth_json(state).await {
                        Ok(_) => {}
                        Err(error) => eprintln!("[auth-import] 自动导入失败: {error}"),
                    }
                });
            }

            // 启动时整理账号活跃时段（关闭残留段 + 当前活跃账号开新段）。
            {
                let period_app = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    ensure_account_period_on_startup(&period_app.state::<AppState>());
                });
            }

            #[cfg(desktop)]
            show_main_window(app.handle());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            accounts::get_accounts,
            auth::validate_personal_token,
            auth::exchange_refresh_token,
            accounts::save_rt_account,
            auth::oauth::start_oauth_login,
            auth::oauth::check_oauth_callback,
            auth::oauth::complete_oauth_login,
            accounts::add_account,
            accounts::update_account,
            accounts::delete_account,
            accounts::set_active_account,
            accounts::set_account_access_token,
            accounts::set_auto_activate_window,
            accounts::quiet_hours::get_quota_quiet_hours,
            accounts::quiet_hours::set_quota_quiet_hours,
            accounts::credits::get_reset_credits,
            accounts::credits::consume_reset_credit,
            accounts::usage::refresh_account_usage,
            accounts::messages::send_test_message,
            codex::config::get_codex_config,
            codex::config::get_codex_config_path,
            codex::config::save_codex_config,
            codex::version::get_codex_versions,
            sessions::sync::sync_sessions,
            sessions::sync::get_session_sync_status,
            sessions::list_session_projects,
            sessions::list::list_sessions,
            sessions::list_project_sessions,
            sessions::get_session_content,
            sessions::usage::get_token_usage,
            updates::get_pending_update,
            updates::set_pending_update,
            updates::get_update_install_mode,
            updates::install_portable_update,
            accounts::import_account_from_auth_json,
            skills::list_skills,
            skills::get_skill_detail,
            skills::add_skill,
            skills::delete_skill,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, event| match event {
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen {
            has_visible_windows,
            ..
        } => {
            if !has_visible_windows {
                show_main_window(_app_handle);
            }
        }
        _ => {}
    });
}
