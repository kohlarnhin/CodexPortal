use crate::state::AppState;
use rusqlite::params;
use tauri::State;

/// 已提醒过用户的新版本号（用户关闭更新弹窗后记录，用于避免重复打扰）。
#[tauri::command]
pub(crate) fn get_pending_update(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let version: Option<String> = db
        .query_row(
            "SELECT content FROM configs WHERE key = 'updater_pending_version'",
            [],
            |row| row.get(0),
        )
        .ok();
    Ok(version.filter(|value| !value.trim().is_empty()))
}

/// 记录已提醒过的新版本号（每次检测到新版本时写入，无论弹窗是否被关闭）。
#[tauri::command]
pub(crate) fn set_pending_update(
    state: State<'_, AppState>,
    version: String,
) -> Result<(), String> {
    let version = version.trim().to_string();
    if version.is_empty() {
        return Err("版本号不能为空".to_string());
    }
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO configs (key, content) VALUES ('updater_pending_version', ?1) ON CONFLICT(key) DO UPDATE SET content = ?1",
        params![version],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
