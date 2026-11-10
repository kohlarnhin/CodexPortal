pub(crate) mod install;
mod ipc;
mod server;

use crate::accounts::{read_accounts, scheduling};
use crate::state::AppState;
use std::ffi::OsString;
use tauri::Manager;

fn mcp_requested(mut args: impl Iterator<Item = OsString>) -> bool {
    args.next().is_some_and(|arg| arg == "mcp")
}

/// 在初始化 Tauri 之前分流；stdio 进程只通过本地端点访问正在运行的 Portal。
pub fn run_if_requested() -> Option<i32> {
    if !mcp_requested(std::env::args_os().skip(1)) { return None; }
    server::run();
    Some(0)
}

pub(crate) fn start(app: &tauri::AppHandle) {
    let Some(path) = ipc::endpoint_path() else {
        crate::logging::warn("mcp", "无法获取 MCP 端点目录，MCP 服务未启动。");
        return;
    };
    let handler_app = app.clone();
    match ipc::Server::start(&path, move |command| {
        match command {
            "status" => {
                let state = handler_app.state::<AppState>();
                let store = {
                    let db = state.db.lock().map_err(|error| error.to_string())?;
                    read_accounts(&db)?
                };
                serde_json::to_value(scheduling::agent_status(&store, chrono::Utc::now().timestamp()))
                    .map_err(|error| error.to_string())
            }
            "switch" => {
                // IPC handler 在普通 std 线程运行，可以等待异步调度完成。
                let result = tauri::async_runtime::block_on(scheduling::switch_on_demand(&handler_app))?;
                serde_json::to_value(result).map_err(|error| error.to_string())
            }
            _ => Err("未知的 MCP 命令。".into()),
        }
    }) {
        Ok(server) => { app.manage(server); }
        Err(_) => crate::logging::warn("mcp", "无法建立 MCP 端点，MCP 服务未启动。"),
    }
}

pub(crate) fn stop(app: &tauri::AppHandle) {
    if let Some(server) = app.try_state::<ipc::Server>() { server.stop(); }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_an_exact_first_mcp_argument_diverts_from_gui() {
        for (args, expected) in [
            (vec![], false),
            (vec!["-psn_0_1"], false),
            (vec!["--help"], false),
            (vec!["switch", "--json"], false),
            (vec!["other", "mcp"], false),
            (vec!["MCP"], false),
            (vec!["mcp"], true),
            (vec!["mcp", "anything"], true),
        ] {
            assert_eq!(mcp_requested(args.into_iter().map(OsString::from)), expected);
        }
    }
}
