use tauri::{Emitter, Manager, Theme};

pub(crate) fn show_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    #[cfg(target_os = "macos")]
    let _ = app.show();

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub(crate) fn show_page(app: &tauri::AppHandle, page: &str) {
    show_main_window(app);
    let _ = app.emit_to("main", "tray-navigate", page);
}

fn parse_window_theme(theme: &str) -> Result<Option<Theme>, String> {
    match theme {
        "system" => Ok(None),
        "light" => Ok(Some(Theme::Light)),
        "dark" => Ok(Some(Theme::Dark)),
        _ => Err(format!("不支持的外观主题：{theme}")),
    }
}

#[tauri::command]
pub(crate) fn set_window_theme(app: tauri::AppHandle, theme: String) -> Result<(), String> {
    let parsed = parse_window_theme(&theme)?;
    if let Some(window) = app.get_webview_window("main") {
        window
            .set_theme(parsed)
            .map_err(|error| format!("应用窗口外观失败：{error}"))?;
    }
    Ok(())
}

pub(crate) fn handle_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if window.label() != "main" {
        return;
    }
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        // macOS 保留 Dock 恢复行为；其他桌面平台在托盘开启时关闭到托盘。
        if cfg!(target_os = "macos") || crate::tray::is_enabled(window.app_handle()) {
            if window.hide().is_ok() {
                api.prevent_close();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_supported_window_themes() {
        assert_eq!(parse_window_theme("system").unwrap(), None);
        assert_eq!(parse_window_theme("light").unwrap(), Some(Theme::Light));
        assert_eq!(parse_window_theme("dark").unwrap(), Some(Theme::Dark));
        assert!(parse_window_theme("sepia").is_err());
    }
}
