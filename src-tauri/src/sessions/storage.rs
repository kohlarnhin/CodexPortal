use crate::db::{get_config_value, set_config_value};
use crate::state::AppState;
use rusqlite::{params, Connection};
use std::thread;
use std::time::Duration;
use tauri::Manager;

const CONTENT_CLEARED_KEY: &str = "sessions_content_cleared";
const CLEAR_BATCH_SIZE: i64 = 5;
const BATCH_PAUSE: Duration = Duration::from_millis(50);
const MEGABYTE: i64 = 1024 * 1024;

pub(crate) fn start_content_cleanup(app: tauri::AppHandle) {
    thread::spawn(move || match clear_stored_content(&app.state::<AppState>()) {
        Ok(Some((before, after))) => crate::logging::info(
            "session-sync",
            format!(
                "数据库中的会话正文已移除，数据库从 {} MB 压缩到 {} MB；正文改为从本地会话文件读取。",
                before / MEGABYTE,
                after / MEGABYTE,
            ),
        ),
        Ok(None) => {}
        Err(_) => crate::logging::warn("session-sync", "移除数据库中的会话正文失败，下次启动时重试。"),
    });
}

fn clear_stored_content(state: &AppState) -> Result<Option<(i64, i64)>, String> {
    {
        let db = state.db.lock().map_err(|error| error.to_string())?;
        if get_config_value(&db, CONTENT_CLEARED_KEY).is_some() {
            return Ok(None);
        }
    }
    crate::logging::info("session-sync", "开始移除数据库中的会话正文，完成后自动压缩数据库。");
    let mut after_rowid = 0;
    loop {
        let cleared = {
            let db = state.db.lock().map_err(|error| error.to_string())?;
            clear_content_batch(&db, after_rowid)?
        };
        let Some(last_rowid) = cleared else { break };
        after_rowid = last_rowid;
        thread::sleep(BATCH_PAUSE);
    }
    let db = state.db.lock().map_err(|error| error.to_string())?;
    let before = database_size(&db)?;
    db.execute_batch("VACUUM").map_err(|error| error.to_string())?;
    db.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()))
        .map_err(|error| error.to_string())?;
    let after = database_size(&db)?;
    set_config_value(&db, CONTENT_CLEARED_KEY, "1");
    Ok(Some((before, after)))
}

fn clear_content_batch(db: &Connection, after_rowid: i64) -> Result<Option<i64>, String> {
    let last_rowid: Option<i64> = db
        .query_row(
            "SELECT MAX(rowid) FROM (SELECT rowid FROM sessions WHERE rowid > ?1 ORDER BY rowid LIMIT ?2)",
            params![after_rowid, CLEAR_BATCH_SIZE],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let Some(last_rowid) = last_rowid else {
        return Ok(None);
    };
    db.execute(
        "UPDATE sessions SET content = '' WHERE rowid > ?1 AND rowid <= ?2",
        params![after_rowid, last_rowid],
    )
    .map_err(|error| error.to_string())?;
    Ok(Some(last_rowid))
}

fn database_size(db: &Connection) -> Result<i64, String> {
    db.query_row(
        "SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()",
        [],
        |row| row.get(0),
    )
    .map_err(|error| error.to_string())
}
