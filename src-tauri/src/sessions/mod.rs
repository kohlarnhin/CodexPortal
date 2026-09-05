pub(crate) mod parser;
pub(crate) mod sync;
pub(crate) mod usage;

#[cfg(test)]
pub(crate) mod test_support;

use crate::state::AppState;
use rusqlite::params;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
pub(crate) struct SessionProject {
    pub(crate) path: String,
    pub(crate) name: String,
    #[serde(rename = "sessionCount")]
    pub(crate) session_count: i64,
    #[serde(rename = "totalTokens")]
    pub(crate) total_tokens: i64,
    #[serde(rename = "firstSessionAt")]
    pub(crate) first_session_at: Option<String>,
    #[serde(rename = "lastSessionAt")]
    pub(crate) last_session_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct SessionRecord {
    pub(crate) id: String,
    #[serde(rename = "projectPath")]
    pub(crate) project_path: String,
    #[serde(rename = "filePath")]
    pub(crate) file_path: String,
    pub(crate) title: String,
    #[serde(rename = "startedAt")]
    pub(crate) started_at: String,
    #[serde(rename = "lastActivityAt")]
    pub(crate) last_activity_at: Option<String>,
    #[serde(rename = "modelProvider")]
    pub(crate) model_provider: Option<String>,
    #[serde(rename = "cliVersion")]
    pub(crate) cli_version: Option<String>,
    #[serde(rename = "fileSize")]
    pub(crate) file_size: i64,
    #[serde(rename = "messageCount")]
    pub(crate) message_count: i64,
    pub(crate) model: Option<String>,
    #[serde(rename = "inputTokens")]
    pub(crate) input_tokens: i64,
    #[serde(rename = "cachedInputTokens")]
    pub(crate) cached_input_tokens: i64,
    #[serde(rename = "outputTokens")]
    pub(crate) output_tokens: i64,
    #[serde(rename = "reasoningTokens")]
    pub(crate) reasoning_tokens: i64,
    #[serde(rename = "totalTokens")]
    pub(crate) total_tokens: i64,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct SessionSyncProgress {
    pub(crate) done: usize,
    pub(crate) total: usize,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct SessionSyncResult {
    pub(crate) total: usize,
    pub(crate) imported: usize,
    pub(crate) updated: usize,
    pub(crate) removed: usize,
    pub(crate) skipped: usize,
    pub(crate) failed: usize,
    pub(crate) projects: usize,
    #[serde(rename = "syncedAt")]
    pub(crate) synced_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct SessionSyncStatus {
    #[serde(rename = "lastSyncedAt")]
    pub(crate) last_synced_at: Option<String>,
    #[serde(rename = "nextSyncAt")]
    pub(crate) next_sync_at: Option<String>,
    #[serde(rename = "totalProjects")]
    pub(crate) total_projects: i64,
    #[serde(rename = "totalSessions")]
    pub(crate) total_sessions: i64,
}

#[tauri::command]
pub(crate) fn list_session_projects(
    state: State<'_, AppState>,
) -> Result<Vec<SessionProject>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare(
            "SELECT path, name, session_count, total_tokens, first_session_at, last_session_at FROM session_projects ORDER BY last_session_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SessionProject {
                path: row.get(0)?,
                name: row.get(1)?,
                session_count: row.get(2)?,
                total_tokens: row.get(3)?,
                first_session_at: row.get(4)?,
                last_session_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut projects = Vec::new();
    for row in rows {
        projects.push(row.map_err(|e| e.to_string())?);
    }
    Ok(projects)
}

#[tauri::command]
pub(crate) fn list_project_sessions(
    state: State<'_, AppState>,
    project_path: String,
) -> Result<Vec<SessionRecord>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare(
            "SELECT id, project_path, file_path, title, started_at, last_activity_at, model_provider, cli_version, file_size, message_count, model, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, total_tokens FROM sessions WHERE project_path = ?1 ORDER BY started_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![project_path], |row| {
            Ok(SessionRecord {
                id: row.get(0)?,
                project_path: row.get(1)?,
                file_path: row.get(2)?,
                title: row.get(3)?,
                started_at: row.get(4)?,
                last_activity_at: row.get(5)?,
                model_provider: row.get(6)?,
                cli_version: row.get(7)?,
                file_size: row.get(8)?,
                message_count: row.get(9)?,
                model: row.get(10)?,
                input_tokens: row.get(11)?,
                cached_input_tokens: row.get(12)?,
                output_tokens: row.get(13)?,
                reasoning_tokens: row.get(14)?,
                total_tokens: row.get(15)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut sessions = Vec::new();
    for row in rows {
        sessions.push(row.map_err(|e| e.to_string())?);
    }
    Ok(sessions)
}

/// 读取单个会话的完整内容（JSONL 原文，可能较大，按需加载）。
#[tauri::command]
pub(crate) fn get_session_content(
    state: State<'_, AppState>,
    id: String,
) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.query_row(
        "SELECT content FROM sessions WHERE id = ?1",
        params![id],
        |row| row.get::<_, String>(0),
    )
    .map_err(|_| "会话不存在".to_string())
}
