use crate::accounts::periods::{ensure_active_account_period, load_active_periods, ActivePeriod};
use crate::accounts::usage::{update_account_usage_from_session, AccountRefreshEvent};
use crate::db::set_config_value;
use crate::sessions::parser::{
    extract_cwd_from_content, extract_session_summary, parse_session_meta, project_display_name,
};
use crate::sessions::{SessionSyncProgress, SessionSyncResult, SessionSyncStatus};
use crate::state::AppState;
use chrono::DateTime;
use chrono::Utc;
use rusqlite::params;
use rusqlite::Connection;
use rusqlite::OptionalExtension;
use serde_json::Value;
use std::collections::HashMap;
use std::collections::HashSet;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use std::sync::OnceLock;
use std::thread;
use std::time::{Duration, Instant};
use tauri::Emitter;
use tauri::Manager;

// ==================== Sessions（~/.codex/sessions）管理 ====================

/// 自动同步间隔：每 5 分钟增量扫描一次 sessions 目录。
const SESSION_SYNC_INTERVAL_SECONDS: i64 = 5 * 60;

/// 会话正文解析规则版本：修改摘要或用量解析逻辑后递增。
/// 版本不一致时后台同步会一次性重解析已有会话，以更新会话摘要和每日 Token 用量；
/// 完成后仍恢复为按 mtime/size 判断的纯增量同步。
/// 首行 ID 和子会话标记每轮都会核对，无需因此触发正文全量重解析。
const SESSIONS_SCHEMA_VERSION: &str = "6";

fn sessions_schema_needs_reparse(db: &Connection) -> bool {
    db.query_row(
        "SELECT content FROM configs WHERE key = 'sessions_schema_version'",
        [],
        |row| row.get::<_, String>(0),
    )
    .map(|stored| stored != SESSIONS_SCHEMA_VERSION)
    .unwrap_or(true)
}

/// 判断当前是否需要同步：从未同步 / 记录无效 / 已到下一次同步时间 → 需要同步。
/// 重启后若下次同步时间在未来，则跳过，等到了那个时间点再同步。
fn session_sync_due(next_sync_at: Option<&str>, now: DateTime<Utc>) -> bool {
    let Some(ts) = next_sync_at else {
        return true;
    };
    match DateTime::parse_from_rfc3339(ts) {
        Ok(time) => time.with_timezone(&Utc) <= now,
        Err(_) => true,
    }
}

/// 距下一次同步的睡眠秒数：未到期 → 睡到那一刻（最多 5 分钟醒一次检查，避免长睡漏掉变化）；
/// 已到期/无记录 → 30 秒后重查。
fn session_sync_sleep_secs(next_sync_at: Option<&str>, now: DateTime<Utc>) -> u64 {
    let Some(ts) = next_sync_at else {
        return 30;
    };
    match DateTime::parse_from_rfc3339(ts) {
        Ok(time) if time.with_timezone(&Utc) > now => {
            let secs = (time.with_timezone(&Utc) - now).num_seconds();
            secs.clamp(1, SESSION_SYNC_INTERVAL_SECONDS) as u64
        }
        _ => 30,
    }
}

fn sessions_dir() -> Result<PathBuf, String> {
    Ok(crate::codex::paths::codex_home()?.join("sessions"))
}

/// 读取失败时终止本次扫描，不能将没有读取权限的目录误当成已删除。
fn scan_session_files_in(root: &PathBuf) -> Result<Vec<(PathBuf, i64, i64)>, String> {
    fn walk(dir: &PathBuf, out: &mut Vec<(PathBuf, i64, i64)>) -> Result<(), String> {
        for entry in fs::read_dir(dir).map_err(|e| format!("无法扫描 Session 目录: {e}"))? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let file_type = entry.file_type().map_err(|e| e.to_string())?;
            if file_type.is_dir() {
                walk(&path, out)?;
            } else if file_type.is_file()
                && path.extension().and_then(|ext| ext.to_str()) == Some("jsonl")
            {
                let meta = entry.metadata().map_err(|e| e.to_string())?;
                let mtime = meta
                    .modified()
                    .map_err(|e| e.to_string())?
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(|e| e.to_string())?
                    .as_secs() as i64;
                out.push((path, mtime, meta.len() as i64));
            }
        }
        Ok(())
    }
    let mut files = Vec::new();
    match fs::metadata(root) {
        Ok(_) => walk(root, &mut files)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("无法读取 Session 目录: {error}")),
    }
    Ok(files)
}

/// 归档只是日志目录变化，不删除已发生的消费。
fn scan_session_files() -> Result<Vec<(PathBuf, i64, i64)>, String> {
    let dir = sessions_dir()?;
    let mut files = scan_session_files_in(&dir)?;
    if let Some(codex_dir) = dir.parent() {
        files.extend(scan_session_files_in(&codex_dir.join("archived_sessions"))?);
    }
    files.sort_by(|left, right| (left.1, left.2, &left.0).cmp(&(right.1, right.2, &right.0)));
    Ok(files)
}

struct SessionFileToSync {
    path: PathBuf,
    mtime_secs: i64,
    file_size: i64,
    id: String,
    is_subagent: bool,
}

/// 只读取首行识别独立会话；同 ID 的日志稳定选择修改时间最新的一份，
/// 时间相同时选择较大的文件，再按路径排序，避免副本在每轮同步中反复覆盖。
fn select_session_files(files: &[(PathBuf, i64, i64)]) -> (Vec<SessionFileToSync>, usize, usize) {
    let mut selected = HashMap::new();
    let mut duplicates = 0usize;
    let mut failed = 0usize;
    // scan_session_files 已按修改时间、大小、路径升序排列，保留同 ID 的最后一份。
    for (path, mtime_secs, file_size) in files {
        let meta = fs::File::open(path).ok().and_then(|file| {
            let mut first_line = String::new();
            BufReader::new(file).read_line(&mut first_line).ok()?;
            parse_session_meta(&first_line)
        });
        let Some(meta) = meta else {
            failed += 1;
            continue;
        };
        let file = SessionFileToSync {
            path: path.clone(),
            mtime_secs: *mtime_secs,
            file_size: *file_size,
            id: meta.id.clone(),
            is_subagent: meta.is_subagent,
        };
        if selected.insert(meta.id, file).is_some() {
            duplicates += 1;
        }
    }
    let mut selected: Vec<SessionFileToSync> = selected.into_values().collect();
    selected.sort_by(|left, right| {
        (left.mtime_secs, left.file_size, &left.path)
            .cmp(&(right.mtime_secs, right.file_size, &right.path))
    });
    (selected, duplicates, failed)
}

/// 执行一次同步（全量或增量）：扫描磁盘 → 比对入库 → 清理已删除 → 重建项目聚合。
///
/// 文件读取和 JSON 解析在数据库锁外执行；每个会话独立事务写入并释放锁，
/// 避免首次全量导入或大文件解析期间阻塞其它页面查询。
/// `force_full` 为 true 时（规则版本升级触发），对已入库会话也重新解析
/// 元数据（标题等），未变化的文件不重写 content，避免大文件内容反复写入。
/// `reset` 会在目录扫描成功后清空同步缓存，再从本地文件完整导入。
/// 以 `syncing_sessions` 标志防重入；进度经 `session-sync-progress` 事件推送。
fn sync_sessions_inner(
    app: &tauri::AppHandle,
    force_full: bool,
    reset: bool,
) -> Result<SessionSyncResult, String> {
    {
        let state = app.state::<AppState>();
        let mut syncing = state.syncing_sessions.lock().map_err(|e| e.to_string())?;
        if *syncing {
            return Err("会话正在同步中，请稍候".to_string());
        }
        *syncing = true;
    }

    crate::logging::info("session-sync", if reset {
        "开始清空并重新同步会话。"
    } else if force_full {
        "开始全量同步会话。"
    } else {
        "开始增量同步会话。"
    });
    let mut reset_completed = false;
    let result = (|| {
        let scan_started_at = Utc::now().to_rfc3339();
        let files = scan_session_files()?;
        let total = files.len();
        let (session_files, duplicates, mut failed) = select_session_files(&files);
        let session_ids: HashSet<&str> = session_files.iter().map(|file| file.id.as_str()).collect();
        let handled_without_import = duplicates + failed;
        let mut imported = 0usize;
        let mut updated = 0usize;
        let mut skipped = 0usize;
        let mut removed = 0usize;
        // 本次同步中额度被会话感知实际更新的账号（结束后通知前端刷新展示）。
        let mut usage_updated_accounts: HashSet<String> = HashSet::new();
        let now = Utc::now().to_rfc3339();

        let state = app.state::<AppState>();
        if reset {
            {
                let mut db = state.db.lock().map_err(|e| e.to_string())?;
                let tx = db.transaction().map_err(|e| e.to_string())?;
                tx.execute_batch(
                    "DELETE FROM session_daily_tokens;
                     DELETE FROM session_projects;
                     DELETE FROM sessions;
                     DELETE FROM configs WHERE key IN (
                        'sessions_last_synced_at', 'sessions_next_sync_at',
                        'sessions_last_sync_failed', 'sessions_schema_version'
                     );",
                )
                .map_err(|e| format!("无法重置已同步会话：{e}"))?;
                tx.commit().map_err(|e| e.to_string())?;
            }
            reset_completed = true;
            let _ = app.emit("sessions-reset", ());
        }
        // 每轮核对首行 ID，旧版误用父会话 ID 的记录即使文件未变，也会重新入库修复。
        let mut existing: HashMap<String, (String, i64, i64, bool)> = HashMap::new();
        let mut existing_ids = HashSet::new();
        {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            // 确保当前活跃账号有进行中时段，供会话返回的剩余额度匹配对应账号。
            ensure_active_account_period(&db).map_err(|e| e.to_string())?;
            let mut stmt = db
                .prepare("SELECT file_path, id, mtime_secs, file_size, is_subagent FROM sessions")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, bool>(4)?,
                    ))
                })
                .map_err(|e| e.to_string())?;
            for row in rows.flatten() {
                existing_ids.insert(row.1.clone());
                existing.insert(row.0, (row.1, row.2, row.3, row.4));
            }
        }

        let mut last_progress_at = Instant::now();
        for (index, file) in session_files.iter().enumerate() {
            let path = &file.path;
            let mtime_secs = &file.mtime_secs;
            let file_size = &file.file_size;
            // 跳过和读取失败也计入进度；限制事件频率，避免大量文件让前端反复渲染。
            if index == 0 || last_progress_at.elapsed() >= Duration::from_millis(100) {
                let _ = app.emit(
                    "session-sync-progress",
                    SessionSyncProgress {
                        done: handled_without_import + index,
                        total,
                    },
                );
                last_progress_at = Instant::now();
            }

            let key = path.to_string_lossy().to_string();
            let unchanged = existing.get(&key).is_some_and(|(id, mtime, size, _)| {
                id == &file.id && mtime == mtime_secs && size == file_size
            });
            if !force_full && unchanged {
                if existing.get(&key).is_some_and(|row| row.3 != file.is_subagent) {
                    // 旧缓存只补子会话标记，无需重读正文或重算用量。
                    let db = state.db.lock().map_err(|e| e.to_string())?;
                    db.execute(
                        "UPDATE sessions SET is_subagent = ?1 WHERE id = ?2 AND file_path = ?3",
                        params![file.is_subagent, file.id, key],
                    )
                    .map_err(|e| e.to_string())?;
                    updated += 1;
                } else {
                    skipped += 1;
                }
                continue;
            }

            let Ok(content) = fs::read_to_string(path) else {
                failed += 1;
                continue;
            };
            let lines: Vec<&str> = content.lines().collect();
            if lines
                .iter()
                .any(|line| !line.trim().is_empty() && serde_json::from_str::<Value>(line).is_err())
            {
                failed += 1;
                continue;
            }
            let Some(mut meta) = lines.first().and_then(|line| parse_session_meta(line)) else {
                failed += 1;
                continue;
            };
            // 扫描后文件可能被替换；下一轮重新识别，避免用过期分组覆盖其他会话。
            if meta.id != file.id {
                failed += 1;
                continue;
            }
            // 旧格式会话没有 cwd，从环境上下文里补全。
            if meta.project_path.is_empty() {
                meta.project_path = extract_cwd_from_content(&content);
            }
            let mut periods: Vec<ActivePeriod> = {
                let db = state.db.lock().map_err(|e| e.to_string())?;
                load_active_periods(&db)
            };
            let mut parsed = extract_session_summary(&lines, &periods);
            let last_activity_at =
                DateTime::from_timestamp(*mtime_secs, 0).map(|time| time.to_rfc3339());

            let mut db = loop {
                let db = state.db.lock().map_err(|e| e.to_string())?;
                let current_periods = load_active_periods(&db);
                if current_periods == periods {
                    break db;
                }
                // 解析期间可能切换账号；释放锁后按最新时段重解析，保留按轮次归属语义。
                drop(db);
                periods = current_periods;
                parsed = extract_session_summary(&lines, &periods);
            };
            let tx = db.transaction().map_err(|e| e.to_string())?;

            // 以事务内的现状清理旧 ID，不能根据扫描前的快照删除已修复父会话的统计。
            let previous_id: Option<String> = tx
                .query_row(
                    "SELECT id FROM sessions WHERE file_path = ?1",
                    params![key],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            let removed_stale_id = previous_id
                .as_ref()
                .is_some_and(|id| id != &meta.id && !session_ids.contains(id.as_str()));
            if let Some(previous_id) = previous_id.filter(|id| id != &meta.id) {
                tx.execute(
                    "DELETE FROM session_daily_tokens WHERE session_id = ?1",
                    params![previous_id],
                )
                .map_err(|e| e.to_string())?;
                tx.execute("DELETE FROM sessions WHERE file_path = ?1", params![key])
                    .map_err(|e| e.to_string())?;
            }

            // 该会话按天用量：先删旧行再重建（会话 resume 增长后需重算当天分布）。
            tx.execute(
                "DELETE FROM session_daily_tokens WHERE session_id = ?1",
                params![meta.id],
            )
            .map_err(|e| e.to_string())?;
            for (date, daily) in &parsed.daily {
                tx.execute(
                    "INSERT OR REPLACE INTO session_daily_tokens (date, project_path, session_id, model, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, total_tokens) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                    params![date, meta.project_path, meta.id, parsed.model, daily.input_tokens, daily.cached_input_tokens, daily.output_tokens, daily.reasoning_tokens, daily.total_tokens],
                )
                .map_err(|e| e.to_string())?;
            }

            // 当前账号由实时推送维护，历史文件同步只补充非当前账号的额度缓存。
            let current_account_id: Option<String> = tx.query_row(
                "SELECT id FROM accounts WHERE is_active = 1 LIMIT 1", [], |row| row.get(0),
            ).optional().map_err(|error| error.to_string())?;
            for (account_id, usage) in &parsed.account_usage {
                if current_account_id.as_ref() == Some(account_id) { continue; }
                if update_account_usage_from_session(&tx, account_id, usage)? {
                    usage_updated_accounts.insert(account_id.clone());
                }
            }

            if unchanged {
                // 文件未变（仅规则升级触发的全量重解析）：只更新元数据字段，不重写 content。
                tx.execute(
                    "UPDATE sessions SET id = ?1, project_path = ?2, title = ?3, started_at = ?4, last_activity_at = ?5, model_provider = ?6, cli_version = ?7, message_count = ?8, model = ?9, input_tokens = ?10, cached_input_tokens = ?11, output_tokens = ?12, reasoning_tokens = ?13, total_tokens = ?14, synced_at = ?15, is_subagent = ?17 WHERE file_path = ?16",
                    params![
                        meta.id,
                        meta.project_path,
                        parsed.title,
                        meta.started_at,
                        last_activity_at,
                        meta.model_provider,
                        meta.cli_version,
                        parsed.message_count,
                        parsed.model,
                        parsed.input_tokens,
                        parsed.cached_input_tokens,
                        parsed.output_tokens,
                        parsed.reasoning_tokens,
                        parsed.total_tokens,
                        now,
                        key,
                        meta.is_subagent
                    ],
                )
                .map_err(|e| e.to_string())?;
            } else {
                tx.execute(
                    "INSERT INTO sessions (id, project_path, file_path, title, started_at, last_activity_at, mtime_secs, file_size, model_provider, cli_version, message_count, model, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, total_tokens, content, synced_at, is_subagent)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)
                     ON CONFLICT(id) DO UPDATE SET
                        project_path = excluded.project_path, file_path = excluded.file_path,
                        title = excluded.title, started_at = excluded.started_at,
                        last_activity_at = excluded.last_activity_at, mtime_secs = excluded.mtime_secs,
                        file_size = excluded.file_size, model_provider = excluded.model_provider,
                        cli_version = excluded.cli_version, message_count = excluded.message_count,
                        model = excluded.model, input_tokens = excluded.input_tokens,
                        cached_input_tokens = excluded.cached_input_tokens, output_tokens = excluded.output_tokens,
                        reasoning_tokens = excluded.reasoning_tokens, total_tokens = excluded.total_tokens,
                        content = excluded.content, synced_at = excluded.synced_at,
                        is_subagent = excluded.is_subagent",
                    params![
                        meta.id,
                        meta.project_path,
                        key,
                        parsed.title,
                        meta.started_at,
                        last_activity_at,
                        mtime_secs,
                        file_size,
                        meta.model_provider,
                        meta.cli_version,
                        parsed.message_count,
                        parsed.model,
                        parsed.input_tokens,
                        parsed.cached_input_tokens,
                        parsed.output_tokens,
                        parsed.reasoning_tokens,
                        parsed.total_tokens,
                        content,
                        now,
                        meta.is_subagent
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
            tx.commit().map_err(|e| e.to_string())?;
            drop(db);
            // 新增按独立会话 ID 计数；归档或副本路径变化只算更新。
            if existing_ids.insert(meta.id.clone()) {
                imported += 1;
            } else {
                updated += 1;
            }
            if removed_stale_id {
                removed += 1;
            }
        }
        let _ = app.emit(
            "session-sync-progress",
            SessionSyncProgress { done: total, total },
        );

        // 删除磁盘上已不存在的会话 + 重建项目聚合（数据量小，短暂持锁即可）。
        let mut db = state.db.lock().map_err(|e| e.to_string())?;
        let tx = db.transaction().map_err(|e| e.to_string())?;

        // 磁盘上已不存在的会话（被删除/清理）。
        let disk_paths: HashSet<String> = files
            .iter()
            .map(|(path, _, _)| path.to_string_lossy().to_string())
            .collect();
        {
            let mut stmt = tx
                .prepare("SELECT file_path FROM sessions")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            for file_path in rows.flatten() {
                if !disk_paths.contains(&file_path) {
                    if let Ok(session_id) = tx.query_row(
                        "SELECT id FROM sessions WHERE file_path = ?1",
                        params![file_path],
                        |row| row.get::<_, String>(0),
                    ) {
                        tx.execute(
                            "DELETE FROM session_daily_tokens WHERE session_id = ?1",
                            params![session_id],
                        )
                        .map_err(|e| e.to_string())?;
                    }
                    tx.execute(
                        "DELETE FROM sessions WHERE file_path = ?1",
                        params![file_path],
                    )
                    .map_err(|e| e.to_string())?;
                    removed += 1;
                }
            }
        }

        // 重建项目聚合（计数、总 token、首末时间）：
        // 仅在有会话变更或聚合过期时重建；无变化时保留现有聚合。
        // 中断自愈：sessions 最新写入时间晚于聚合的同步时间（上次重建未完成）→ 强制重建。
        let sessions_latest: Option<String> = tx
            .query_row("SELECT MAX(synced_at) FROM sessions", [], |row| row.get(0))
            .ok();
        let projects_synced: Option<String> = tx
            .query_row("SELECT MAX(synced_at) FROM session_projects", [], |row| {
                row.get(0)
            })
            .ok();
        let aggregate_stale = match (&sessions_latest, &projects_synced) {
            (Some(a), Some(b)) => a > b,
            (Some(_), None) => true,
            _ => false,
        };
        let mut projects = 0usize;
        if imported + updated + removed > 0 || aggregate_stale {
            tx.execute("DELETE FROM session_projects", [])
                .map_err(|e| e.to_string())?;
            let mut stmt = tx
                .prepare(
                    "SELECT project_path, COUNT(*), SUM(total_tokens), MIN(started_at), MAX(last_activity_at) FROM sessions GROUP BY project_path",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, Option<String>>(4)?,
                    ))
                })
                .map_err(|e| e.to_string())?;
            for row in rows.flatten() {
                let name = project_display_name(&row.0);
                tx.execute(
                    "INSERT INTO session_projects (path, name, session_count, total_tokens, first_session_at, last_session_at, synced_at) VALUES (?1,?2,?3,?4,?5,?6,?7)",
                    params![row.0, name, row.1, row.2, row.3, row.4, now],
                )
                .map_err(|e| e.to_string())?;
                projects += 1;
            }
        } else {
            // 0 变更：聚合未重建，直接读库里现有项目数（保持结果语义一致）。
            projects = tx
                .query_row("SELECT COUNT(*) FROM session_projects", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap_or(0) as usize;
        }

        let (session_count, subagent_count): (i64, i64) = tx
            .query_row(
                "SELECT COUNT(*), COALESCE(SUM(is_subagent), 0) FROM sessions",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;

        // 记录本次同步时间、下次同步时间与当前入库规则版本。
        // 手动同步与自动同步统一在这里刷新，调度器据此决定重启后是否需要同步。
        let next_sync_at =
            (Utc::now() + chrono::Duration::seconds(SESSION_SYNC_INTERVAL_SECONDS)).to_rfc3339();
        if failed == 0 {
            db.execute(
                "INSERT INTO configs (key, content) VALUES ('sessions_last_synced_at', ?1) ON CONFLICT(key) DO UPDATE SET content = ?1",
                params![scan_started_at],
            ).map_err(|e| e.to_string())?;
        }
        set_config_value(&db, "sessions_last_sync_failed", &failed.to_string());
        let _ = db.execute(
            "INSERT INTO configs (key, content) VALUES ('sessions_next_sync_at', ?1) ON CONFLICT(key) DO UPDATE SET content = ?1",
            params![next_sync_at],
        );
        if failed == 0 {
            db.execute(
                "INSERT INTO configs (key, content) VALUES ('sessions_schema_version', ?1) ON CONFLICT(key) DO UPDATE SET content = ?1",
                params![SESSIONS_SCHEMA_VERSION],
            ).map_err(|e| e.to_string())?;
        }

        // 额度被会话感知更新的账号 → 通知前端刷新展示（复用额度刷新事件）。
        for account_id in &usage_updated_accounts {
            let _ = app.emit(
                "usage-updated",
                AccountRefreshEvent {
                    account_id: account_id.clone(),
                },
            );
        }

        Ok::<SessionSyncResult, String>(SessionSyncResult {
            total,
            imported,
            updated,
            removed,
            skipped,
            duplicates,
            failed,
            projects,
            session_count: session_count as usize,
            subagent_count: subagent_count as usize,
            synced_at: now,
        })
    })();

    let result = result.map_err(|error| {
        if reset_completed {
            format!("已清空已同步会话，但重新同步失败：{error}。请点击“立即同步”重试。")
        } else {
            error
        }
    });
    if result.is_err() {
        let state = app.state::<AppState>();
        if let Ok(db) = state.db.lock() {
            set_config_value(&db, "sessions_last_sync_failed", "1");
        };
    }
    {
        let state = app.state::<AppState>();
        if let Ok(mut syncing) = state.syncing_sessions.lock() {
            *syncing = false;
        };
    }
    if let Err(error) = &result {
        crate::logging::error("session-sync", "会话同步失败，请在会话管理中查看错误详情并重试。");
        let _ = app.emit("session-sync-failed", error);
    } else if let Ok(summary) = &result {
        let message = format!(
            "同步完成：扫描 {} 个文件，新增 {}，更新 {}，删除 {}，未变化 {}，重复文件 {}，失败 {}，共 {} 个会话、{} 个项目。",
            summary.total, summary.imported, summary.updated, summary.removed,
            summary.skipped, summary.duplicates, summary.failed, summary.session_count, summary.projects,
        );
        if summary.failed > 0 {
            crate::logging::warn("session-sync", message);
        } else {
            crate::logging::info("session-sync", message);
        }
    }
    result
}

/// 自动同步调度器：同步时间与下次同步时间持久化在数据库中。
/// - 重启后：下次同步时间在未来 → 跳过同步，睡到那个时间点（最多 5 分钟醒一次检查）；
/// - 从未同步 / 已到下次同步时间 → 同步（首次全量入库或增量），完成后刷新两个时间。
/// 入库规则升级时自动做一次全量重解析以完成迁移；其余时间始终纯增量。
static SESSION_SYNC_REQUESTED: AtomicBool = AtomicBool::new(false);

static SESSION_SYNC_THREAD: OnceLock<thread::Thread> = OnceLock::new();

pub(crate) fn request_session_sync() {
    SESSION_SYNC_REQUESTED.store(true, Ordering::Release);
    if let Some(worker) = SESSION_SYNC_THREAD.get() {
        worker.unpark();
    }
}

pub(crate) fn start_session_sync_scheduler(app: tauri::AppHandle) {
    thread::spawn(move || {
        let _ = SESSION_SYNC_THREAD.set(thread::current());
        loop {
            let requested = SESSION_SYNC_REQUESTED.swap(false, Ordering::AcqRel);
            let (due, sleep_secs, force_full) = {
                let state = app.state::<AppState>();
                let locked = state.db.lock();
                match locked {
                    Ok(db) => {
                        let next_sync_at: Option<String> = db
                            .query_row(
                                "SELECT content FROM configs WHERE key = 'sessions_next_sync_at'",
                                [],
                                |row| row.get(0),
                            )
                            .ok();
                        let now = Utc::now();
                        let force_full = sessions_schema_needs_reparse(&db);
                        (
                            requested
                                || force_full
                                || session_sync_due(next_sync_at.as_deref(), now),
                            session_sync_sleep_secs(next_sync_at.as_deref(), now),
                            force_full,
                        )
                    }
                    Err(_) => (false, 30, false),
                }
            };

            if due {
                match sync_sessions_inner(&app, force_full, false) {
                    Ok(result) => {
                        let _ = app.emit("session-sync-completed", result);
                    }
                    Err(error) => {
                        if requested && error == "会话正在同步中，请稍候" {
                            thread::park_timeout(Duration::from_secs(1));
                            SESSION_SYNC_REQUESTED.store(true, Ordering::Release);
                        }
                    }
                }
            } else {
                crate::logging::info("session-sync", format!("未到下次同步时间，{sleep_secs}s 后检查。"));
            }

            if !SESSION_SYNC_REQUESTED.load(Ordering::Acquire) {
                thread::park_timeout(Duration::from_secs(sleep_secs));
            }
        }
    });
}

/// 手动触发一次同步（前端按钮），结果同时经 `session-sync-completed` 事件推送。
/// 入库规则版本升级时自动附带一次全量重解析（元数据）；版本一致时与自动同步一样是纯增量。
#[tauri::command]
pub(crate) async fn sync_sessions(app: tauri::AppHandle) -> Result<SessionSyncResult, String> {
    let thread_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let force_full = {
            let state = thread_app.state::<AppState>();
            let db = state.db.lock().map_err(|e| e.to_string())?;
            sessions_schema_needs_reparse(&db)
        };
        sync_sessions_inner(&thread_app, force_full, false)
    })
    .await
    .map_err(|e| format!("会话同步任务失败：{e}"))??;
    let _ = app.emit("session-sync-completed", &result);
    Ok(result)
}

/// 清空同步缓存并重新导入；与手动/自动同步共用互斥标志，保留原始会话文件。
#[tauri::command]
pub(crate) async fn reset_sessions(app: tauri::AppHandle) -> Result<SessionSyncResult, String> {
    let thread_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        sync_sessions_inner(&thread_app, false, true)
    })
    .await
    .map_err(|e| format!("会话重置任务失败：{e}"))??;
    let _ = app.emit("session-sync-completed", &result);
    Ok(result)
}

#[tauri::command]
pub(crate) async fn get_session_sync_status(
    app: tauri::AppHandle,
    include_subagents: Option<bool>,
) -> Result<SessionSyncStatus, String> {
    crate::db::with_db(app.clone(), move |db| {
        let state = app.state::<AppState>();
        let is_syncing = *state.syncing_sessions.lock().map_err(|e| e.to_string())?;
        query_session_sync_status(db, is_syncing, include_subagents.unwrap_or(false))
    })
    .await
}

fn query_session_sync_status(
    db: &Connection,
    is_syncing: bool,
    include_subagents: bool,
) -> Result<SessionSyncStatus, String> {
    let last_synced_at: Option<String> = db
        .query_row(
            "SELECT content FROM configs WHERE key = 'sessions_last_synced_at'",
            [],
            |row| row.get(0),
        )
        .ok();
    let next_sync_at: Option<String> = db
        .query_row(
            "SELECT content FROM configs WHERE key = 'sessions_next_sync_at'",
            [],
            |row| row.get(0),
        )
        .ok();
    let total_sessions: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM sessions WHERE ?1 = 1 OR is_subagent = 0",
            params![include_subagents],
            |row| row.get(0),
        )
        .unwrap_or(0);
    let total_projects: i64 = db
        .query_row(
            "SELECT COUNT(DISTINCT project_path) FROM sessions WHERE ?1 = 1 OR is_subagent = 0",
            params![include_subagents],
            |row| row.get(0),
        )
        .unwrap_or(0);
    Ok(SessionSyncStatus {
        is_syncing,
        last_synced_at,
        next_sync_at,
        total_projects,
        total_sessions,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sessions::test_support::{meta_line, response_item_line};
    use crate::test_support::utc_ts;
    use uuid::Uuid;

    #[test]
    fn session_sync_due_never_synced_is_due() {
        let now = utc_ts("2026-08-12T10:00:00Z");
        assert!(session_sync_due(None, now));
    }

    #[test]
    fn session_sync_due_skips_when_next_in_future() {
        let now = utc_ts("2026-08-12T10:00:00Z");
        // 重启后下一次同步时间在未来 → 不同步。
        assert!(!session_sync_due(Some("2026-08-12T10:05:00Z"), now));
        // 已到/超过下一次同步时间 → 同步。
        assert!(session_sync_due(Some("2026-08-12T10:00:00Z"), now));
        assert!(session_sync_due(Some("2026-08-12T09:59:00Z"), now));
        // 记录无效 → 视为需要同步。
        assert!(session_sync_due(Some("not-a-time"), now));
    }

    #[test]
    fn session_sync_sleep_waits_until_next_time() {
        let now = utc_ts("2026-08-12T10:00:00Z");
        // 距离下次同步 100 秒 → 睡 100 秒（精确触发）。
        assert_eq!(
            session_sync_sleep_secs(Some("2026-08-12T10:01:40Z"), now),
            100
        );
        // 距离超过 5 分钟 → 最多 5 分钟醒一次检查。
        assert_eq!(
            session_sync_sleep_secs(Some("2026-08-12T10:30:00Z"), now),
            300
        );
        // 已到期 / 无记录 → 30 秒后重查。
        assert_eq!(
            session_sync_sleep_secs(Some("2026-08-12T09:59:00Z"), now),
            30
        );
        assert_eq!(session_sync_sleep_secs(None, now), 30);
    }

    #[test]
    fn sync_sessions_incremental_and_aggregation() {
        // 用内存库 + 临时 sessions 目录验证：首次入库、mtime 未变跳过、删除清理、项目聚合。
        let home = std::env::temp_dir().join(format!("codex-portal-test-{}", Uuid::new_v4()));
        let sessions_root = home
            .join(".codex")
            .join("sessions")
            .join("2026")
            .join("08")
            .join("11");
        fs::create_dir_all(&sessions_root).unwrap();
        let file = sessions_root.join("rollout-2026-08-11T09-10-42-sess-001.jsonl");
        let content = format!(
            "{}\n{}\n{}",
            meta_line("/Users/u/Projects/demo"),
            response_item_line("user", "帮我加一个功能"),
            response_item_line("assistant", "好的")
        );
        fs::write(&file, content).unwrap();

        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions (
                id TEXT PRIMARY KEY, project_path TEXT NOT NULL, file_path TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL, started_at TEXT NOT NULL, last_activity_at TEXT,
                mtime_secs INTEGER NOT NULL, file_size INTEGER NOT NULL,
                model_provider TEXT, cli_version TEXT,
                message_count INTEGER NOT NULL DEFAULT 0,
                model TEXT,
                input_tokens INTEGER NOT NULL DEFAULT 0,
                cached_input_tokens INTEGER NOT NULL DEFAULT 0,
                output_tokens INTEGER NOT NULL DEFAULT 0,
                reasoning_tokens INTEGER NOT NULL DEFAULT 0,
                total_tokens INTEGER NOT NULL DEFAULT 0,
                content TEXT NOT NULL, synced_at TEXT NOT NULL
            )",
        )
        .unwrap();
        conn.execute_batch(
            "CREATE TABLE session_projects (
                path TEXT PRIMARY KEY, name TEXT NOT NULL,
                session_count INTEGER NOT NULL DEFAULT 0,
                total_tokens INTEGER NOT NULL DEFAULT 0,
                first_session_at TEXT, last_session_at TEXT, synced_at TEXT
            )",
        )
        .unwrap();

        let files = scan_session_files_in(&home.join(".codex").join("sessions")).unwrap();
        assert!(
            files.iter().any(|(path, _, _)| path == &file),
            "扫描应找到临时会话文件"
        );
        let file_meta = files
            .iter()
            .find(|(path, _, _)| path == &file)
            .map(|(_, mtime, size)| (*mtime, *size))
            .unwrap();
        let raw = fs::read_to_string(&file).unwrap();
        let lines: Vec<&str> = raw.lines().collect();
        let meta = parse_session_meta(lines.first().unwrap()).unwrap();
        let parsed = extract_session_summary(&lines, &[]);
        assert_eq!(meta.id, "sess-001");
        assert_eq!(parsed.title, "帮我加一个功能");
        assert_eq!(parsed.message_count, 2);

        conn.execute(
            "INSERT INTO sessions (id, project_path, file_path, title, started_at, last_activity_at, mtime_secs, file_size, message_count, content, synced_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![meta.id, meta.project_path, file.to_string_lossy(), parsed.title, meta.started_at, None::<String>, file_meta.0, file_meta.1, parsed.message_count, raw, "2026-08-11T10:00:00Z"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO session_projects (path, name, session_count, first_session_at, last_session_at, synced_at) VALUES ('/Users/u/Projects/demo', 'demo', 1, '2026-08-11T09:10:42.358Z', '2026-08-11T09:11:00.000Z', '2026-08-11T10:00:00Z')",
            [],
        )
        .unwrap();

        let file_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(file_count, 1);
        fs::remove_dir_all(&home).unwrap();
    }
}
