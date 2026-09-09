use rusqlite::params;
use rusqlite::Connection;
use rusqlite::Result as SqlResult;
use std::collections::HashSet;

pub(crate) fn init_db(conn: &Connection) -> SqlResult<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS accounts (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            auth_json_content TEXT NOT NULL,
            notes TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            is_active INTEGER NOT NULL,
            plan_type TEXT NOT NULL DEFAULT 'weekly',
            usage_json TEXT,
            usage_updated_at TEXT,
            next_refresh_at TEXT,
            chatgpt_plan_type TEXT,
            access_token TEXT,
            chatgpt_account_id TEXT,
            chatgpt_account_is_fedramp INTEGER NOT NULL DEFAULT 0,
            reset_credits_json TEXT,
            refresh_token TEXT,
            at_expires_at TEXT,
            auto_activate_window INTEGER NOT NULL DEFAULT 0
        )",
        [],
    )?;

    let _ = conn.execute(
        "ALTER TABLE accounts ADD COLUMN plan_type TEXT NOT NULL DEFAULT 'weekly'",
        [],
    );
    let _ = conn.execute("ALTER TABLE accounts ADD COLUMN usage_json TEXT", []);
    let _ = conn.execute("ALTER TABLE accounts ADD COLUMN usage_updated_at TEXT", []);
    let _ = conn.execute("ALTER TABLE accounts ADD COLUMN next_refresh_at TEXT", []);
    let _ = conn.execute("ALTER TABLE accounts ADD COLUMN chatgpt_plan_type TEXT", []);
    let _ = conn.execute("ALTER TABLE accounts ADD COLUMN access_token TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE accounts ADD COLUMN chatgpt_account_id TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE accounts ADD COLUMN chatgpt_account_is_fedramp INTEGER NOT NULL DEFAULT 0",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE accounts ADD COLUMN reset_credits_json TEXT",
        [],
    );
    let _ = conn.execute("ALTER TABLE accounts ADD COLUMN refresh_token TEXT", []);
    let _ = conn.execute("ALTER TABLE accounts ADD COLUMN at_expires_at TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE accounts ADD COLUMN auto_activate_window INTEGER NOT NULL DEFAULT 0",
        [],
    );

    conn.execute(
        "CREATE TABLE IF NOT EXISTS configs (
            key TEXT PRIMARY KEY,
            content TEXT NOT NULL
        )",
        [],
    )?;

    // Codex 配置只由本地文件管理；移除旧副本，保留 Portal 内部运行状态。
    conn.execute(
        "DELETE FROM configs WHERE key IN ('codex_config', 'mcp_config')",
        [],
    )?;

    // WAL 模式：sessions 全量同步耗时较长，写库期间账号额度等读操作不阻塞。
    let _ = conn.pragma_update(None, "journal_mode", "WAL");

    // 账号活跃时段：切换账号时关闭旧段、开启新段，供会话返回的剩余额度按账号归属。
    conn.execute(
        "CREATE TABLE IF NOT EXISTS account_active_periods (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT
        )",
        [],
    )?;
    // 移除已停用的窗口消费统计表；账号认证、剩余额度缓存和会话用量继续保留。
    conn.execute_batch(
        "DROP TABLE IF EXISTS account_quota_observations;
         DROP TABLE IF EXISTS account_token_events;
         DROP TABLE IF EXISTS account_quota_windows;
         DROP TABLE IF EXISTS account_window_snapshots;
         DROP TABLE IF EXISTS account_token_usage;",
    )?;
    let period_columns = {
        let mut stmt = conn.prepare("PRAGMA table_info(account_active_periods)")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
        rows.collect::<SqlResult<HashSet<_>>>()?
    };
    for column in ["start_used_percent", "last_used_percent", "last_sensed_at"] {
        if period_columns.contains(column) {
            conn.execute(
                &format!("ALTER TABLE account_active_periods DROP COLUMN {column}"),
                [],
            )?;
        }
    }

    // 按天 token 用量：同步时把每个会话的 token_count 累计值做增量差分，归入本地日期。
    conn.execute(
        "CREATE TABLE IF NOT EXISTS session_daily_tokens (
            date TEXT NOT NULL,
            project_path TEXT NOT NULL,
            session_id TEXT NOT NULL,
            model TEXT,
            input_tokens INTEGER NOT NULL DEFAULT 0,
            cached_input_tokens INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            reasoning_tokens INTEGER NOT NULL DEFAULT 0,
            total_tokens INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (date, session_id)
        )",
        [],
    )?;

    // ~/.codex/sessions 的会话索引：按项目（cwd）聚合。
    conn.execute(
        "CREATE TABLE IF NOT EXISTS session_projects (
            path TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            session_count INTEGER NOT NULL DEFAULT 0,
            total_tokens INTEGER NOT NULL DEFAULT 0,
            first_session_at TEXT,
            last_session_at TEXT,
            synced_at TEXT
        )",
        [],
    )?;

    // 每个 session 文件的完整内容（JSONL 原文）与解析出的元信息（含 token 消耗）。
    conn.execute(
        "CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            project_path TEXT NOT NULL,
            file_path TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            started_at TEXT NOT NULL,
            last_activity_at TEXT,
            mtime_secs INTEGER NOT NULL,
            file_size INTEGER NOT NULL,
            model_provider TEXT,
            cli_version TEXT,
            message_count INTEGER NOT NULL DEFAULT 0,
            model TEXT,
            input_tokens INTEGER NOT NULL DEFAULT 0,
            cached_input_tokens INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            reasoning_tokens INTEGER NOT NULL DEFAULT 0,
            total_tokens INTEGER NOT NULL DEFAULT 0,
            content TEXT NOT NULL,
            synced_at TEXT NOT NULL
        )",
        [],
    )?;

    Ok(())
}

pub(crate) fn get_config_value(db: &Connection, key: &str) -> Option<String> {
    db.query_row(
        "SELECT content FROM configs WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .ok()
}

pub(crate) fn set_config_value(db: &Connection, key: &str, value: &str) {
    let _ = db.execute(
        "INSERT INTO configs (key, content) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET content = ?2",
        params![key, value],
    );
}
