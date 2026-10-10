use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::{Emitter, Manager};

const DISPLAY_LIMIT: usize = 100;
static LOGGER: OnceLock<AppLogger> = OnceLock::new();

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum LogLevel {
    Info,
    Warn,
    Error,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LogEntry {
    sequence: u64,
    timestamp: String,
    level: LogLevel,
    source: String,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LogSnapshot {
    entries: Vec<LogEntry>,
    file_path: Option<String>,
    file_error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LogUpdate {
    entry: LogEntry,
    file_error: Option<String>,
}

struct LogStore {
    entries: VecDeque<LogEntry>,
    next_sequence: u64,
    file_error: Option<String>,
}

struct AppLogger {
    app: tauri::AppHandle,
    file_path: Option<PathBuf>,
    store: Mutex<LogStore>,
}

// 从文件尾向前读取，启动时只恢复最近 100 条，不将全部历史载入内存。
// 此函数只读文件；展示窗口淘汰旧条目不会改写或删除历史日志。
fn read_recent_entries(path: &Path) -> std::io::Result<(VecDeque<LogEntry>, bool)> {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok((VecDeque::new(), true));
        }
        Err(error) => return Err(error),
    };
    let mut position = file.seek(SeekFrom::End(0))?;
    let mut pending = Vec::new();
    let mut entries = Vec::new();
    let mut ends_with_newline = true;
    let mut first_chunk = true;

    while position > 0 && entries.len() < DISPLAY_LIMIT {
        let length = position.min(8192) as usize;
        position -= length as u64;
        file.seek(SeekFrom::Start(position))?;
        let mut buffer = vec![0; length];
        file.read_exact(&mut buffer)?;
        if first_chunk {
            ends_with_newline = buffer.last() == Some(&b'\n');
            first_chunk = false;
        }
        buffer.extend_from_slice(&pending);

        let boundary = buffer.iter().position(|byte| *byte == b'\n');
        let complete_start = if position == 0 {
            0
        } else if let Some(index) = boundary {
            index + 1
        } else {
            pending = buffer;
            continue;
        };
        for line in buffer[complete_start..].rsplit(|byte| *byte == b'\n') {
            if let Ok(entry) = serde_json::from_slice::<LogEntry>(line) {
                entries.push(entry);
                if entries.len() == DISPLAY_LIMIT {
                    break;
                }
            }
        }
        pending = if position > 0 {
            buffer[..boundary.unwrap_or(0)].to_vec()
        } else {
            Vec::new()
        };
    }

    entries.reverse();
    Ok((entries.into_iter().collect(), ends_with_newline))
}

fn open_append_file(path: &Path) -> std::io::Result<File> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut options = OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

pub(crate) fn initialize(app: &tauri::AppHandle) {
    let (file_path, mut file_error) = match app.path().app_log_dir() {
        Ok(directory) => (Some(directory.join("codex-portal.log")), None),
        Err(error) => (None, Some(format!("无法获取日志目录：{error}"))),
    };
    let mut entries = VecDeque::new();
    let mut history_warning = false;
    if let Some(path) = &file_path {
        match read_recent_entries(path) {
            Ok((recent, ends_with_newline)) => {
                entries = recent;
                // 只追加换行，避免意外退出留下的末行与下一条日志粘连。
                if !ends_with_newline {
                    if let Err(error) = open_append_file(path).and_then(|mut file| file.write_all(b"\n")) {
                        file_error = Some(format!("无法写入日志文件：{error}"));
                    }
                }
            }
            Err(error) => {
                file_error = Some(format!("无法读取历史日志：{error}"));
                history_warning = true;
            }
        }
    }
    let next_sequence = entries.iter().map(|entry| entry.sequence).max().unwrap_or(0) + 1;
    let logger = AppLogger {
        app: app.clone(),
        file_path,
        store: Mutex::new(LogStore { entries, next_sequence, file_error }),
    };
    if LOGGER.set(logger).is_err() {
        return;
    }
    info("app", format!("Codex Portal {} 已启动", app.package_info().version));
    if history_warning {
        warn("app", "历史日志读取失败，本次运行日志仍将实时显示。");
    }
}

// 调用方只传入运行状态和计数，不记录认证内容、账号邮箱或配置正文。
fn record(level: LogLevel, source: &str, message: String) {
    eprintln!("[{source}] {message}");
    let Some(logger) = LOGGER.get() else { return };
    let Ok(mut store) = logger.store.lock() else { return };
    let entry = LogEntry {
        sequence: store.next_sequence,
        timestamp: Utc::now().to_rfc3339(),
        level,
        source: source.to_string(),
        message,
    };
    store.next_sequence += 1;
    if let Some(path) = &logger.file_path {
        let saved = (|| -> Result<(), String> {
            let mut line = serde_json::to_vec(&entry).map_err(|error| error.to_string())?;
            line.push(b'\n');
            let mut file = open_append_file(path).map_err(|error| error.to_string())?;
            if store.file_error.is_some() {
                // 前一次写入可能只完成了半行；追加分隔后再继续，保留原有字节。
                file.write_all(b"\n").map_err(|error| error.to_string())?;
            }
            file.write_all(&line).map_err(|error| error.to_string())
        })();
        store.file_error = saved.err().map(|error| format!("无法写入日志文件：{error}"));
    }
    store.entries.push_back(entry.clone());
    if store.entries.len() > DISPLAY_LIMIT {
        store.entries.pop_front();
    }
    // 持锁发送，确保并发任务的事件顺序与文件、快照中的顺序相同。
    let _ = logger.app.emit("app-log-entry", LogUpdate {
        entry,
        file_error: store.file_error.clone(),
    });
}

pub(crate) fn info(source: &str, message: impl Into<String>) {
    record(LogLevel::Info, source, message.into());
}

pub(crate) fn warn(source: &str, message: impl Into<String>) {
    record(LogLevel::Warn, source, message.into());
}

pub(crate) fn error(source: &str, message: impl Into<String>) {
    record(LogLevel::Error, source, message.into());
}

#[tauri::command]
pub(crate) fn get_recent_logs() -> Result<LogSnapshot, String> {
    let logger = LOGGER.get().ok_or("日志服务尚未初始化")?;
    let store = logger.store.lock().map_err(|error| error.to_string())?;
    Ok(LogSnapshot {
        entries: store.entries.iter().cloned().collect(),
        file_path: logger.file_path.as_ref().map(|path| path.to_string_lossy().into_owned()),
        file_error: store.file_error.clone(),
    })
}
