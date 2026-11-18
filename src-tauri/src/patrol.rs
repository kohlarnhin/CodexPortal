use std::thread;
use std::time::Duration;
use tauri::Emitter;

/// 唯一的业务维护时钟。各模块只做非阻塞派发，慢任务不占用巡检线程。
pub(crate) fn start(app: tauri::AppHandle) {
    thread::spawn(move || loop {
        crate::accounts::scheduler::dispatch(&app);
        crate::accounts::scheduling::dispatch_patrol(&app);
        crate::sessions::sync::dispatch_sync(&app);
        crate::tray::request_refresh(&app);
        let _ = app.emit("patrol-tick", ());
        thread::sleep(Duration::from_secs(30));
    });
}
