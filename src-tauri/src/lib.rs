use rusqlite::{params, Connection, Result as SqlResult, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use tauri::{Manager, State};
use uuid::Uuid;
use chrono::Utc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub name: String,
    #[serde(rename = "authJsonContent")]
    pub auth_json_content: String,
    pub notes: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    #[serde(rename = "planType")]
    pub plan_type: String,
    #[serde(skip)]
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountStore {
    #[serde(rename = "activeAccountId")]
    pub active_account_id: Option<String>,
    pub accounts: Vec<Account>,
}

pub struct AppState {
    pub db: Mutex<Connection>,
}

impl AppState {
    fn init_db(conn: &Connection) -> SqlResult<()> {
        conn.execute(
            "CREATE TABLE IF NOT EXISTS accounts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                auth_json_content TEXT NOT NULL,
                notes TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                is_active INTEGER NOT NULL,
                plan_type TEXT NOT NULL DEFAULT 'weekly'
            )",
            [],
        )?;
        
        let _ = conn.execute("ALTER TABLE accounts ADD COLUMN plan_type TEXT NOT NULL DEFAULT 'weekly'", []);
        
        conn.execute(
            "CREATE TABLE IF NOT EXISTS configs (
                key TEXT PRIMARY KEY,
                content TEXT NOT NULL
            )",
            [],
        )?;
        Ok(())
    }
}

#[tauri::command]
fn get_accounts(state: State<'_, AppState>) -> Result<AccountStore, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    
    let mut stmt = db.prepare("SELECT id, name, auth_json_content, notes, created_at, updated_at, is_active, plan_type FROM accounts ORDER BY created_at ASC").map_err(|e| e.to_string())?;
    let account_iter = stmt.query_map([], |row| {
        Ok(Account {
            id: row.get(0)?,
            name: row.get(1)?,
            auth_json_content: row.get(2)?,
            notes: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
            is_active: row.get::<_, i32>(6)? == 1,
            plan_type: row.get(7)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut accounts = Vec::new();
    let mut active_account_id = None;

    for account_result in account_iter {
        let account = account_result.map_err(|e| e.to_string())?;
        if account.is_active {
            active_account_id = Some(account.id.clone());
        }
        accounts.push(account);
    }

    Ok(AccountStore {
        active_account_id,
        accounts,
    })
}

#[tauri::command]
fn add_account(
    state: State<'_, AppState>,
    name: String,
    auth_json_content: String,
    notes: Option<String>,
    plan_type: String,
) -> Result<Account, String> {
    let now = Utc::now().to_rfc3339();
    let account = Account {
        id: Uuid::new_v4().to_string(),
        name,
        auth_json_content,
        notes,
        created_at: now.clone(),
        updated_at: now,
        plan_type: plan_type.clone(),
        is_active: false,
    };

    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    
    let count: i32 = db.query_row("SELECT COUNT(*) FROM accounts", [], |row| row.get(0)).unwrap_or(0);
    let mut account_to_return = account.clone();
    account_to_return.is_active = count == 0;

    let tx = db.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO accounts (id, name, auth_json_content, notes, created_at, updated_at, is_active, plan_type) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![account.id, account.name, account.auth_json_content, account.notes, account.created_at, account.updated_at, if count == 0 { 1 } else { 0 }, plan_type],
    ).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    
    if count == 0 {
        let _ = apply_auth_json(&account.auth_json_content);
    }

    Ok(account_to_return)
}

#[tauri::command]
fn update_account(
    state: State<'_, AppState>,
    id: String,
    name: String,
    auth_json_content: String,
    notes: Option<String>,
    plan_type: String,
) -> Result<Account, String> {
    let now = Utc::now().to_rfc3339();
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    
    let tx = db.transaction().map_err(|e| e.to_string())?;
    
    let rows_affected = tx.execute(
        "UPDATE accounts SET name = ?1, auth_json_content = ?2, notes = ?3, updated_at = ?4, plan_type = ?5 WHERE id = ?6",
        params![name, auth_json_content, notes, now, plan_type, id],
    ).map_err(|e| e.to_string())?;
    
    if rows_affected == 0 {
        return Err("Account not found".to_string());
    }
    
    let is_active: i32 = tx.query_row("SELECT is_active FROM accounts WHERE id = ?1", params![id], |row| row.get(0)).unwrap_or(0);
    
    tx.commit().map_err(|e| e.to_string())?;
    
    if is_active == 1 {
        let _ = apply_auth_json(&auth_json_content);
    }

    Ok(Account {
        id,
        name,
        auth_json_content,
        notes,
        created_at: "".to_string(), // Frontend doesn't need to update created_at usually
        updated_at: now,
        plan_type,
        is_active: is_active == 1,
    })
}

#[tauri::command]
fn delete_account(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    
    let is_active: i32 = tx.query_row("SELECT is_active FROM accounts WHERE id = ?1", params![id], |row| row.get(0)).unwrap_or(0);
    
    tx.execute("DELETE FROM accounts WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    
    if is_active == 1 {
        let next_id: Option<String> = tx.query_row("SELECT id FROM accounts LIMIT 1", [], |row| row.get(0)).optional().unwrap_or(None);
        if let Some(nid) = next_id {
            tx.execute("UPDATE accounts SET is_active = 1 WHERE id = ?1", params![nid]).unwrap_or(0);
            if let Ok(content) = tx.query_row("SELECT auth_json_content FROM accounts WHERE id = ?1", params![nid], |row| row.get::<_, String>(0)) {
                let _ = apply_auth_json(&content);
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn set_active_account(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    
    let content: String = tx.query_row("SELECT auth_json_content FROM accounts WHERE id = ?1", params![id], |row| row.get(0)).map_err(|_| "Account not found".to_string())?;
    
    tx.execute("UPDATE accounts SET is_active = 0", []).map_err(|e| e.to_string())?;
    tx.execute("UPDATE accounts SET is_active = 1 WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    
    tx.commit().map_err(|e| e.to_string())?;
    
    apply_auth_json(&content)?;
    Ok(())
}

fn apply_auth_json(content: &str) -> Result<(), String> {
    let home_dir = dirs::home_dir().ok_or("Could not find home directory")?;
    let codex_dir = home_dir.join(".codex");
    
    if !codex_dir.exists() {
        fs::create_dir_all(&codex_dir).map_err(|e| format!("Failed to create ~/.codex directory: {}", e))?;
    }
    
    let auth_file_path = codex_dir.join("auth.json");
    fs::write(&auth_file_path, content).map_err(|e| format!("Failed to write auth.json: {}", e))?;
    
    Ok(())
}

fn get_local_file_content(path: &PathBuf) -> Option<String> {
    if path.exists() {
        fs::read_to_string(path).ok()
    } else {
        None
    }
}

#[tauri::command]
fn get_codex_config(state: State<'_, AppState>) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    
    let db_content: Option<String> = db.query_row(
        "SELECT content FROM configs WHERE key = 'codex_config'",
        [],
        |row| row.get(0)
    ).optional().map_err(|e| e.to_string())?;

    if let Some(content) = db_content {
        return Ok(content);
    }

    let home_dir = dirs::home_dir().ok_or("Could not find home directory")?;
    let config_path = home_dir.join(".codex").join("config.toml");
    
    if let Some(local_content) = get_local_file_content(&config_path) {
        db.execute(
            "INSERT INTO configs (key, content) VALUES ('codex_config', ?1)",
            params![local_content],
        ).map_err(|e| e.to_string())?;
        return Ok(local_content);
    }
    
    Err("No configuration found in DB or local".to_string())
}

#[tauri::command]
fn save_codex_config(state: State<'_, AppState>, content: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    
    db.execute(
        "INSERT INTO configs (key, content) VALUES ('codex_config', ?1) ON CONFLICT(key) DO UPDATE SET content = ?1",
        params![content],
    ).map_err(|e| e.to_string())?;

    let home_dir = dirs::home_dir().ok_or("Could not find home directory")?;
    let codex_dir = home_dir.join(".codex");
    
    if !codex_dir.exists() {
        fs::create_dir_all(&codex_dir).map_err(|e| format!("Failed to create ~/.codex directory: {}", e))?;
    }
    
    let config_path = codex_dir.join("config.toml");
    fs::write(&config_path, content).map_err(|e| format!("Failed to write config.toml: {}", e))?;
    
    Ok(())
}

#[derive(Serialize, Deserialize)]
pub struct ConsistencyCheckResult {
    is_consistent: bool,
    db_content: Option<String>,
    local_content: Option<String>,
}

#[tauri::command]
fn check_config_consistency(state: State<'_, AppState>, config_type: String) -> Result<ConsistencyCheckResult, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let key = match config_type.as_str() {
        "codex" => "codex_config",
        "mcp" => "mcp_config",
        _ => return Err("Unknown config type".to_string()),
    };

    let db_content: Option<String> = db.query_row(
        "SELECT content FROM configs WHERE key = ?1",
        params![key],
        |row| row.get(0)
    ).optional().map_err(|e| e.to_string())?;

    let home_dir = dirs::home_dir().ok_or("Could not find home directory")?;
    let file_path = match config_type.as_str() {
        "codex" => home_dir.join(".codex").join("config.toml"),
        "mcp" => home_dir.join(".codex").join("mcp.json"),
        _ => PathBuf::new(),
    };

    let local_content = get_local_file_content(&file_path);

    let is_consistent = match (&db_content, &local_content) {
        (Some(db), Some(local)) => db == local,
        (None, None) => true,
        _ => false,
    };

    Ok(ConsistencyCheckResult {
        is_consistent,
        db_content,
        local_content,
    })
}

#[cfg(target_os = "macos")]
fn add_existing_cli_path(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if path.is_dir() && !paths.contains(&path) {
        paths.push(path);
    }
}

#[cfg(target_os = "macos")]
fn macos_cli_search_path() -> Option<std::ffi::OsString> {
    // Apps launched by Finder inherit a minimal PATH from LaunchServices instead
    // of the user's terminal PATH, so include common CLI installation locations.
    let mut paths = std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect::<Vec<_>>())
        .unwrap_or_default();

    for path in ["/opt/homebrew/bin", "/usr/local/bin"] {
        add_existing_cli_path(&mut paths, PathBuf::from(path));
    }

    if let Some(home_dir) = dirs::home_dir() {
        for path in [
            home_dir.join(".local/bin"),
            home_dir.join(".npm-global/bin"),
            home_dir.join(".volta/bin"),
            home_dir.join(".asdf/shims"),
            home_dir.join(".local/share/mise/shims"),
            home_dir.join(".bun/bin"),
        ] {
            add_existing_cli_path(&mut paths, path);
        }
    }

    std::env::join_paths(paths).ok()
}

fn codex_command() -> Command {
    let mut command = Command::new("codex");

    #[cfg(target_os = "macos")]
    if let Some(path) = macos_cli_search_path() {
        command.env("PATH", path);
    }

    command
}

#[tauri::command]
async fn get_codex_version() -> Result<String, String> {
    let output = codex_command().arg("--version").output().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            format!(
                "未找到 Codex CLI（{}）。请确认已安装 Codex，并可在终端执行 `codex --version`。",
                error
            )
        } else {
            format!("启动 Codex CLI 失败：{}", error)
        }
    })?;
    
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[cfg(desktop)]
fn show_main_window<R: tauri::Runtime>(app_handle: &tauri::AppHandle<R>) {
    #[cfg(target_os = "macos")]
    let _ = app_handle.show();

    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                let _ = window.hide();
                api.prevent_close();
            }
            _ => {}
        })
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");
            fs::create_dir_all(&app_data_dir).expect("Failed to create app data directory");
            
            let db_path = app_data_dir.join("database.sqlite");
            let conn = Connection::open(&db_path).expect("Failed to open SQLite database");
            
            AppState::init_db(&conn).expect("Failed to initialize database schema");

            app.manage(AppState {
                db: Mutex::new(conn),
            });

            #[cfg(desktop)]
            show_main_window(app.handle());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_accounts,
            add_account,
            update_account,
            delete_account,
            set_active_account,
            get_codex_config,
            save_codex_config,
            get_codex_version,
            check_config_consistency,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { has_visible_windows, .. } => {
            if !has_visible_windows {
                show_main_window(app_handle);
            }
        }
        _ => {}
    });
}
