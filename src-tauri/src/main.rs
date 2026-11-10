// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Some(code) = codex_portal_lib::run_mcp_if_requested() {
        std::process::exit(code);
    }
    codex_portal_lib::run()
}
