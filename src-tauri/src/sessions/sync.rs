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
use serde_json::Value;
use std::collections::HashMap;
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use std::sync::OnceLock;
use std::thread;
use std::time::Duration;
use tauri::Emitter;
use tauri::Manager;
use tauri::State;

// ==================== Sessions（~/.codex/sessions）管理 ====================

/// 自动同步间隔：每 5 分钟增量扫描一次 sessions 目录。
const SESSION_SYNC_INTERVAL_SECONDS: i64 = 5 * 60;

/// 会话入库/解析规则版本：修改解析逻辑后递增。
/// 版本不一致时后台同步会一次性重解析已有会话，以更新会话摘要和每日 Token 用量；
/// 完成后仍恢复为按 mtime/size 判断的纯增量同步。
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
    let home = dirs::home_dir().ok_or_else(|| "无法获取用户主目录".to_string())?;
    Ok(home.join(".codex").join("sessions"))
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

/// 执行一次同步（全量或增量）：扫描磁盘 → 比对入库 → 清理已删除 → 重建项目聚合。
///
/// 全程在后台线程执行（异步）；数据库锁按批次持有（每批 50 个文件提交一次并释放锁），
/// 保证首次全量导入或大量新增期间，账号额度等其它查询命令不被长时间阻塞。
/// `force_full` 为 true 时（仅手动同步 + 规则版本升级触发），对已入库会话也重新解析
/// 元数据（标题等），但不重写 content，避免 1.2GB 内容反复写入。
/// 以 `syncing_sessions` 标志防重入；进度经 `session-sync-progress` 事件推送。
fn sync_sessions_inner(
    app: &tauri::AppHandle,
    force_full: bool,
) -> Result<SessionSyncResult, String> {
    {
        let state = app.state::<AppState>();
        let mut syncing = state.syncing_sessions.lock().map_err(|e| e.to_string())?;
        if *syncing {
            return Err("会话正在同步中，请稍候".to_string());
        }
        *syncing = true;
    }

    let result = (|| {
        let scan_started_at = Utc::now().to_rfc3339();
        let files = scan_session_files()?;
        let total = files.len();
        let mut imported = 0usize;
        let mut updated = 0usize;
        let mut skipped = 0usize;
        let mut failed = 0usize;
        // 本次同步中额度被会话感知实际更新的账号（结束后通知前端刷新展示）。
        let mut usage_updated_accounts: HashSet<String> = HashSet::new();
        let now = Utc::now().to_rfc3339();

        let state = app.state::<AppState>();
        let mut db = state.db.lock().map_err(|e| e.to_string())?;

        // 确保当前活跃账号有进行中时段，供新会话返回的剩余额度匹配对应账号。
        ensure_active_account_period(&db).map_err(|e| e.to_string())?;

        // 账号活跃时段（会话返回的剩余额度按账号归属用）。
        let mut periods: Vec<ActivePeriod> = load_active_periods(&db);

        // 库里已有的文件 → (mtime, size)，未变化则跳过（增量同步的核心）。
        let mut existing: HashMap<String, (i64, i64)> = HashMap::new();
        {
            let mut stmt = db
                .prepare("SELECT file_path, mtime_secs, file_size FROM sessions")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                })
                .map_err(|e| e.to_string())?;
            for row in rows.flatten() {
                existing.insert(row.0, (row.1, row.2));
            }
        }

        // 分批提交：每批完成后释放数据库锁片刻，让其它查询命令穿插执行，避免界面卡顿。
        const SYNC_BATCH_SIZE: usize = 50;
        let mut tx = db.transaction().map_err(|e| e.to_string())?;
        for (index, (path, mtime_secs, file_size)) in files.iter().enumerate() {
            if index > 0 && index % SYNC_BATCH_SIZE == 0 {
                tx.commit().map_err(|e| e.to_string())?;
                drop(db);
                thread::sleep(Duration::from_millis(10));
                db = state.db.lock().map_err(|e| e.to_string())?;
                // 释放锁期间可能发生了账号切换：重载时段，避免用过期归属。
                periods = load_active_periods(&db);
                tx = db.transaction().map_err(|e| e.to_string())?;
            }

            let key = path.to_string_lossy().to_string();
            let unchanged = existing.get(&key) == Some(&(*mtime_secs, *file_size));
            if !force_full && unchanged {
                skipped += 1;
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
            // 旧格式会话没有 cwd，从环境上下文里补全。
            if meta.project_path.is_empty() {
                meta.project_path = extract_cwd_from_content(&content);
            }
            let parsed = extract_session_summary(&lines, &periods);
            let last_activity_at =
                DateTime::from_timestamp(*mtime_secs, 0).map(|time| time.to_rfc3339());

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

            // 仅同步会话接口返回的剩余额度，不生成账号消费账本或估算。
            for (account_id, usage) in &parsed.account_usage {
                if update_account_usage_from_session(&tx, account_id, usage)? {
                    usage_updated_accounts.insert(account_id.clone());
                }
            }

            if unchanged {
                // 文件未变（仅规则升级触发的全量重解析）：只更新元数据字段，不重写 content。
                tx.execute(
                    "UPDATE sessions SET id = ?1, project_path = ?2, title = ?3, started_at = ?4, last_activity_at = ?5, model_provider = ?6, cli_version = ?7, message_count = ?8, model = ?9, input_tokens = ?10, cached_input_tokens = ?11, output_tokens = ?12, reasoning_tokens = ?13, total_tokens = ?14, synced_at = ?15 WHERE file_path = ?16",
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
                        key
                    ],
                )
                .map_err(|e| e.to_string())?;
                updated += 1;
            } else {
                let is_new = !existing.contains_key(&key);
                tx.execute(
                    "INSERT OR REPLACE INTO sessions (id, project_path, file_path, title, started_at, last_activity_at, mtime_secs, file_size, model_provider, cli_version, message_count, model, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, total_tokens, content, synced_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)",
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
                        now
                    ],
                )
                .map_err(|e| e.to_string())?;
                if is_new {
                    imported += 1;
                } else {
                    updated += 1;
                }
            }
            if index % 10 == 0 {
                let _ = app.emit(
                    "session-sync-progress",
                    SessionSyncProgress {
                        done: index + 1,
                        total,
                    },
                );
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        drop(db);

        // 删除磁盘上已不存在的会话 + 重建项目聚合（数据量小，短暂持锁即可）。
        let mut db = state.db.lock().map_err(|e| e.to_string())?;
        let tx = db.transaction().map_err(|e| e.to_string())?;

        // 磁盘上已不存在的会话（被删除/清理）。
        let disk_paths: HashSet<String> = files
            .iter()
            .map(|(path, _, _)| path.to_string_lossy().to_string())
            .collect();
        let mut removed = 0usize;
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
        // 仅在有变更（新增/更新/删除）时执行 —— 0 变更的同步只做 stat 比对，零 DB 写入。
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
            failed,
            projects,
            synced_at: now,
        })
    })();

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
                match sync_sessions_inner(&app, force_full) {
                    Ok(result) => {
                        eprintln!(
                        "[session-sync] 同步完成：新增 {}，更新 {}，删除 {}，跳过 {}，失败 {}，共 {} 个项目",
                        result.imported,
                        result.updated,
                        result.removed,
                        result.skipped,
                        result.failed,
                        result.projects
                    );
                        let _ = app.emit("session-sync-completed", result);
                    }
                    Err(error) => {
                        eprintln!("[session-sync] 同步失败: {error}");
                        if requested && error == "会话正在同步中，请稍候" {
                            thread::park_timeout(Duration::from_secs(1));
                            SESSION_SYNC_REQUESTED.store(true, Ordering::Release);
                        }
                    }
                }
            } else {
                eprintln!("[session-sync] 未到下次同步时间，{sleep_secs}s 后检查");
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
    let force_full = {
        let state = app.state::<AppState>();
        let locked = state.db.lock();
        match locked {
            Ok(db) => sessions_schema_needs_reparse(&db),
            Err(_) => true,
        }
    };
    let thread_app = app.clone();
    let result =
        tauri::async_runtime::spawn_blocking(move || sync_sessions_inner(&thread_app, force_full))
            .await
            .map_err(|e| format!("会话同步任务失败：{e}"))??;
    let _ = app.emit("session-sync-completed", &result);
    Ok(result)
}

#[tauri::command]
pub(crate) fn get_session_sync_status(
    state: State<'_, AppState>,
) -> Result<SessionSyncStatus, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
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
        .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
        .unwrap_or(0);
    let total_projects: i64 = db
        .query_row("SELECT COUNT(*) FROM session_projects", [], |row| {
            row.get(0)
        })
        .unwrap_or(0);
    Ok(SessionSyncStatus {
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
