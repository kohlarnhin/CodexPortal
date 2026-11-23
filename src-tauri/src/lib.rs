mod accounts;
mod auth;
mod codex;
mod db;
mod http;
mod logging;
mod mcp;
mod patrol;
mod process;
mod sessions;
mod skills;
mod state;
mod time;
mod traffic_lights;
mod tray;
mod updates;
mod windows;

#[cfg(test)]
mod test_support;

use crate::accounts::periods::ensure_account_period_on_startup;
use crate::db::init_db;
use crate::state::{AppState, OAuthSession};
use crate::windows::show_main_window;
use rusqlite::Connection;
use std::collections::HashSet;
use std::fs;
use std::sync::Mutex;
use tauri::Manager;

pub use mcp::run_if_requested as run_mcp_if_requested;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .on_window_event(windows::handle_window_event)
        .setup(|app| {
            logging::initialize(app.handle());
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
            app.manage(codex::events::EventListenerState::default());
            app.manage(accounts::scheduling::ScheduleState::default());
            mcp::start(app.handle());

            tray::start(app.handle().clone())?;
            accounts::scheduler::start_bootstrap(app.handle().clone());
            patrol::start(app.handle().clone());
            sessions::storage::start_content_cleanup(app.handle().clone());

            // 账号库为空时，后台自动从 ~/.codex/auth.json 导入账号（异步，失败静默）。
            {
                let import_app = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let state = import_app.state::<AppState>();
                    match accounts::import_account_from_auth_json(import_app.clone(), state).await {
                        Ok(_) => {}
                        Err(_) => logging::warn("auth-import", "自动导入账号失败，请在账号管理中手动导入。"),
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

            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = traffic_lights::install(&window) {
                    logging::warn("window", &format!("安装标题栏按钮布局失败：{error}"));
                }
            }

            #[cfg(desktop)]
            show_main_window(app.handle());

            logging::info("app", "应用已就绪，账号与会话后台调度已启动。");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            logging::get_recent_logs,
            windows::set_window_theme,
            codex::events::get_codex_event_url,
            codex::events::get_codex_event_context,
            codex::events::save_codex_live_usage,
            codex::events::report_codex_listener_event,
            accounts::get_accounts,
            tray::get_tray_settings,
            tray::set_tray_enabled,
            tray::set_tray_email_masking,
            tray::get_tray_icon_state,
            tray::set_tray_icon,
            mcp::install::get_claude_mcp_status,
            mcp::install::install_claude_mcp,
            mcp::install::get_codex_mcp_status,
            mcp::install::install_codex_mcp,
            auth::validate_personal_token,
            auth::exchange_refresh_token,
            accounts::save_rt_account,
            accounts::api_keys::save_api_key_account,
            auth::oauth::start_oauth_login,
            auth::oauth::check_oauth_callback,
            auth::oauth::complete_oauth_login,
            accounts::add_account,
            accounts::update_account,
            accounts::update_account_notes,
            accounts::reauth_oauth_account,
            accounts::set_account_enabled,
            accounts::delete_account,
            accounts::set_account_access_token,
            accounts::scheduling::get_schedule_status,
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
            sessions::sync::reset_sessions,
            sessions::sync::get_session_sync_status,
            sessions::list_session_projects,
            sessions::list::list_sessions,
            sessions::list_project_sessions,
            sessions::get_session_content,
            sessions::usage::get_token_usage,
            updates::get_pending_update,
            updates::set_pending_update,
            updates::clear_pending_update,
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
        tauri::RunEvent::Exit => {
            mcp::stop(_app_handle);
            codex::events::stop_event_listener(_app_handle);
        }
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
