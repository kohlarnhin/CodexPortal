use tauri::{Emitter, Manager};

pub(crate) fn show_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    #[cfg(target_os = "macos")]
    let _ = app.show();

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unmaximize();
        // 保留创建时按屏幕工作区限制的尺寸，避免从 Dock / 托盘恢复时重新撑出屏幕。
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub(crate) fn show_page(app: &tauri::AppHandle, page: &str) {
    show_main_window(app);
    let _ = app.emit_to("main", "tray-navigate", page);
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
