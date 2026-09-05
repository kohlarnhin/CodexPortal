use rusqlite::Connection;
use std::collections::HashSet;
use std::sync::Mutex;

/// 一次 OAuth 登录的临时会话状态（本地回调 + 待兑换的 code）。
#[derive(Default)]
pub(crate) struct OAuthSession {
    pub(crate) code_verifier: Option<String>,
    pub(crate) state: Option<String>,
    pub(crate) redirect_uri: Option<String>,
    pub(crate) callback_code: Option<String>,
}

pub(crate) struct AppState {
    pub(crate) db: Mutex<Connection>,
    /// 正在被手动刷新的账号 id，调度器跳过它们避免撞车。
    pub(crate) refreshing: Mutex<HashSet<String>>,
    /// OAuth 登录会话。
    pub(crate) oauth: Mutex<OAuthSession>,
    /// sessions 目录正在同步（手动或自动），避免撞车。
    pub(crate) syncing_sessions: Mutex<bool>,
}
