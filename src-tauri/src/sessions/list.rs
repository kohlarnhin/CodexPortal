use super::{session_from_row, SessionRecord};
use crate::state::AppState;
use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::State;

#[derive(Debug, Serialize)]
pub(crate) struct SessionListPage {
    sessions: Vec<SessionRecord>,
    total: i64,
}

/// 跨项目按会话 ID 片段搜索，只分页读取元信息，正文仍按需加载。
#[tauri::command]
pub(crate) fn list_sessions(
    state: State<'_, AppState>,
    search: Option<String>,
    offset: Option<u32>,
    limit: Option<u32>,
) -> Result<SessionListPage, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    query_sessions(
        &db,
        search.as_deref().unwrap_or_default(),
        offset.unwrap_or(0),
        limit.unwrap_or(50),
    )
    .map_err(|e| e.to_string())
}

fn query_sessions(
    db: &Connection,
    search: &str,
    offset: u32,
    limit: u32,
) -> rusqlite::Result<SessionListPage> {
    let keyword = search.trim().to_ascii_lowercase();
    // instr 按字面匹配，输入中的 %、_ 等字符不会被当成 SQL 通配符。
    let total = db.query_row(
        "SELECT COUNT(*) FROM sessions WHERE ?1 = '' OR instr(lower(id), ?1) > 0",
        params![keyword],
        |row| row.get(0),
    )?;
    let mut stmt = db.prepare(
        "SELECT id, project_path, file_path, title, started_at, last_activity_at,
                model_provider, cli_version, file_size, message_count, model,
                input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, total_tokens
         FROM sessions
         WHERE ?1 = '' OR instr(lower(id), ?1) > 0
         ORDER BY started_at DESC, id DESC
         LIMIT ?2 OFFSET ?3",
    )?;
    let sessions = stmt
        .query_map(
            params![keyword, limit.clamp(1, 100), offset],
            session_from_row,
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(SessionListPage { sessions, total })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        crate::db::init_db(&db).unwrap();
        for (id, project, started_at) in [
            ("alpha-AbC123-tail", "/test/one", "2026-09-06T00:00:00Z"),
            ("beta-abc123-tail", "/test/two", "2026-09-08T00:00:00Z"),
            ("gamma-other", "/test/one", "2026-09-08T00:00:00Z"),
            ("literal-%_quote'", "/test/two", "2026-09-07T00:00:00Z"),
        ] {
            db.execute(
                "INSERT INTO sessions
                 (id, project_path, file_path, title, started_at, mtime_secs, file_size, content, synced_at)
                 VALUES (?1, ?2, ?1 || '.jsonl', 'Test session', ?3, 0, 0, '', ?3)",
                params![id, project, started_at],
            )
            .unwrap();
        }
        db
    }

    #[test]
    fn searches_id_fragments_across_projects_ignoring_case_and_whitespace() {
        let result = query_sessions(&database(), "  ABC123  ", 0, 50).unwrap();
        assert_eq!(result.total, 2);
        assert_eq!(result.sessions[0].id, "beta-abc123-tail");
        assert_eq!(result.sessions[1].id, "alpha-AbC123-tail");
        assert_ne!(
            result.sessions[0].project_path,
            result.sessions[1].project_path
        );
        assert_eq!(
            query_sessions(&database(), "Test session", 0, 50)
                .unwrap()
                .total,
            0
        );
    }

    #[test]
    fn treats_wildcards_and_quotes_literally() {
        let db = database();
        for keyword in ["%", "_", "'"] {
            let result = query_sessions(&db, keyword, 0, 50).unwrap();
            assert_eq!(result.total, 1);
            assert_eq!(result.sessions[0].id, "literal-%_quote'");
        }
        assert_eq!(query_sessions(&db, "' OR 1=1 --", 0, 50).unwrap().total, 0);
    }

    #[test]
    fn paginates_in_stable_order_and_keeps_the_full_match_count() {
        let db = database();
        let first = query_sessions(&db, "", 0, 2).unwrap();
        let second = query_sessions(&db, " \t ", 2, 2).unwrap();
        assert_eq!(first.total, 4);
        assert_eq!(second.total, 4);
        assert_eq!(
            first
                .sessions
                .iter()
                .map(|session| session.id.as_str())
                .collect::<Vec<_>>(),
            ["gamma-other", "beta-abc123-tail"]
        );
        assert_eq!(
            second
                .sessions
                .iter()
                .map(|session| session.id.as_str())
                .collect::<Vec<_>>(),
            ["literal-%_quote'", "alpha-AbC123-tail"]
        );
        assert!(query_sessions(&db, "", 4, 2).unwrap().sessions.is_empty());
        let filtered = query_sessions(&db, "abc123", 1, 1).unwrap();
        assert_eq!(filtered.total, 2);
        assert_eq!(filtered.sessions[0].id, "alpha-AbC123-tail");
        assert_eq!(query_sessions(&db, "", 0, 0).unwrap().sessions.len(), 1);
    }
}
