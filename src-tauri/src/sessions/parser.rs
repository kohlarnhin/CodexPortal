use crate::accounts::periods::{active_period_account, ActivePeriod};
use crate::accounts::usage::{AccountUsageWindow, RateLimitSnapshot};
use crate::time::{rfc3339_timestamp_millis, utc_ts_to_local_date};
use serde_json::Value;
use std::collections::HashMap;
use std::collections::HashSet;
use std::path::PathBuf;

/// 会话文件首行（session_meta）解析出的元信息。
#[derive(Debug, Clone)]
pub(super) struct SessionFileMeta {
    pub(super) id: String,
    pub(super) project_path: String,
    pub(super) started_at: String,
    pub(super) model_provider: Option<String>,
    pub(super) cli_version: Option<String>,
}

/// 解析 JSONL 首行的 session_meta 记录。
/// 兼容旧格式（2025-09 之前）：首行为 `{"id":..., "timestamp":..., "instructions":null}`，
/// 无 type/payload，此时 cwd 为空，由调用方从内容中的 `<cwd>` 环境上下文补全。
pub(super) fn parse_session_meta(line: &str) -> Option<SessionFileMeta> {
    let event: Value = serde_json::from_str(line).ok()?;
    let payload = event.get("payload");
    if payload.is_none() {
        // 旧格式：无 payload 且带 id / timestamp 才视为会话元数据（排除 state 等记录）。
        let id = event.get("id").and_then(Value::as_str)?.to_string();
        let started_at = event
            .get("timestamp")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        return Some(SessionFileMeta {
            id,
            project_path: String::new(),
            started_at,
            model_provider: None,
            cli_version: None,
        });
    }
    let payload = payload?;
    if event.get("type").and_then(Value::as_str) != Some("session_meta") {
        return None;
    }
    let id = payload
        .get("session_id")
        .and_then(Value::as_str)
        .or_else(|| payload.get("id").and_then(Value::as_str))?
        .to_string();
    let started_at = payload
        .get("timestamp")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let project_path = payload
        .get("cwd")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let model_provider = payload
        .get("model_provider")
        .and_then(Value::as_str)
        .map(str::to_string);
    let cli_version = payload
        .get("cli_version")
        .and_then(Value::as_str)
        .map(str::to_string);
    Some(SessionFileMeta {
        id,
        project_path,
        started_at,
        model_provider,
        cli_version,
    })
}

/// 判断注入型用户消息（AGENTS.md / Skill / 环境上下文 / 用户指令模板），这类内容不能作为会话标题。
fn is_injected_user_message(text: &str) -> bool {
    let trimmed = text.trim_start();
    trimmed.starts_with("# AGENTS.md")
        || trimmed.contains("<INSTRUCTIONS>")
        || trimmed.starts_with("# Skills")
        || trimmed.starts_with("<user_instructions>")
        || trimmed.starts_with("<environment_context>")
}

/// 从一条 response_item 消息中提取用户消息文本（多个 input_text 段落拼接）。
fn extract_user_text_from_message(payload: &Value) -> Option<String> {
    if payload.get("type").and_then(Value::as_str) != Some("message") {
        return None;
    }
    if payload.get("role").and_then(Value::as_str) != Some("user") {
        return None;
    }
    let texts: Vec<String> = payload
        .get("content")?
        .as_array()?
        .iter()
        .filter_map(|part| {
            let text = part.get("text")?.as_str()?;
            (!text.trim().is_empty()).then(|| text.to_string())
        })
        .collect();
    if texts.is_empty() {
        None
    } else {
        Some(texts.join("\n"))
    }
}

/// 从会话内容中提取 cwd（旧格式无 session_meta 时，环境上下文里带 `<cwd>路径</cwd>`）。
pub(crate) fn extract_cwd_from_content(content: &str) -> String {
    for line in content.lines() {
        let Some(start) = line.find("<cwd>") else {
            continue;
        };
        let rest = &line[start + 5..];
        if let Some(end) = rest.find("</cwd>") {
            let cwd = rest[..end].trim().to_string();
            if !cwd.is_empty() {
                return cwd;
            }
        }
    }
    String::new()
}

/// 整理标题：压缩空白、限制长度（超出截断并追加省略号）。
fn normalize_title(text: &str, max_chars: usize) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= max_chars {
        collapsed
    } else {
        let mut result: String = collapsed.chars().take(max_chars).collect();
        result.push('…');
        result
    }
}

/// 解析 token_count 事件 rate_limits 里的单个窗口。
/// used_percent 缺失/非数字（含窗口为 null）时返回 None，避免误当 0%（重置回满）。
fn parse_session_rate_limit_window(window: &Value) -> Option<AccountUsageWindow> {
    Some(AccountUsageWindow {
        used_percent: Some(window.get("used_percent").and_then(Value::as_f64)?),
        window_minutes: window.get("window_minutes").and_then(Value::as_i64),
        resets_at: window.get("resets_at").and_then(Value::as_i64),
    })
}

/// 从会话全文行中解析出的摘要：标题、消息数、模型名与 token 消耗。
#[derive(Debug, Default)]
pub(crate) struct SessionParsedSummary {
    pub(crate) title: String,
    pub(crate) message_count: i64,
    pub(crate) model: Option<String>,
    pub(crate) input_tokens: i64,
    pub(crate) cached_input_tokens: i64,
    pub(crate) output_tokens: i64,
    pub(crate) reasoning_tokens: i64,
    pub(crate) total_tokens: i64,
    /// 按本地日期（YYYY-MM-DD）汇总的 token 增量（供 token 用量统计）。
    pub(crate) daily: HashMap<String, SessionDailyTokens>,
    /// 会话接口返回的剩余额度及对应账号，不记录账号消费明细。
    pub(crate) account_usage: Vec<(String, RateLimitSnapshot)>,
}

/// token_count 累计值快照（各维度）。
#[derive(Debug, Clone, Default)]
struct TokenUsageSnapshot {
    input: i64,
    cached_input: i64,
    output: i64,
    reasoning: i64,
    total: i64,
}

impl TokenUsageSnapshot {
    fn from_value(usage: &Value) -> TokenUsageSnapshot {
        TokenUsageSnapshot {
            input: usage
                .get("input_tokens")
                .and_then(Value::as_i64)
                .unwrap_or(0),
            cached_input: usage
                .get("cached_input_tokens")
                .and_then(Value::as_i64)
                .unwrap_or(0),
            output: usage
                .get("output_tokens")
                .and_then(Value::as_i64)
                .unwrap_or(0),
            reasoning: usage
                .get("reasoning_output_tokens")
                .and_then(Value::as_i64)
                .unwrap_or(0),
            total: usage
                .get("total_tokens")
                .and_then(Value::as_i64)
                .unwrap_or(0),
        }
    }

    /// 累计总量回退代表计数器进入新 epoch，所有维度一起重新开始。
    fn delta(&self, prev: &TokenUsageSnapshot) -> TokenUsageSnapshot {
        if self.total < prev.total {
            return self.clone();
        }
        TokenUsageSnapshot {
            input: (self.input - prev.input).max(0),
            cached_input: (self.cached_input - prev.cached_input).max(0),
            output: (self.output - prev.output).max(0),
            reasoning: (self.reasoning - prev.reasoning).max(0),
            total: (self.total - prev.total).max(0),
        }
    }

    fn is_zero(&self) -> bool {
        self.input == 0
            && self.cached_input == 0
            && self.output == 0
            && self.reasoning == 0
            && self.total == 0
    }
}

/// 单个会话在某一日期的 token 增量。
#[derive(Debug, Clone, Default)]
pub(crate) struct SessionDailyTokens {
    pub(crate) input_tokens: i64,
    pub(crate) cached_input_tokens: i64,
    pub(crate) output_tokens: i64,
    pub(crate) reasoning_tokens: i64,
    pub(crate) total_tokens: i64,
}

/// 解析会话全文（单遍遍历）：
/// - 标题：跳过 AGENTS.md / Skill 指令注入，取第一条真实用户消息；
/// - 消息数：response_item 数量；
/// - 模型名：最后一个 thread_settings_applied 的 thread_settings.model；
/// - token：优先采用可校验的 last_token_usage，否则对 total_token_usage 做累计差分；
/// - 剩余额度：按请求所属的账号活跃时段同步接口返回值。
pub(crate) fn extract_session_summary<S: AsRef<str>>(
    lines: &[S],
    periods: &[ActivePeriod],
) -> SessionParsedSummary {
    let mut summary = SessionParsedSummary {
        title: "未命名会话".to_string(),
        ..Default::default()
    };
    let mut title: Option<String> = None;
    let mut prev_usage: Option<TokenUsageSnapshot> = None;
    // 一个 turn 开始后，即使 Portal 切换账号，已发出的请求仍归原账号。
    // 老日志没有 turn 边界时才按 token 事件时刻回退归属。
    let mut turn_account: Option<Option<String>> = None;
    let mut seen_usage_events = HashSet::new();
    for line in lines {
        let line = line.as_ref();
        let Ok(event) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        match event.get("type").and_then(Value::as_str) {
            Some("response_item") => {
                summary.message_count += 1;
                if title.is_none() {
                    if let Some(payload) = event.get("payload") {
                        if let Some(text) = extract_user_text_from_message(payload) {
                            if !is_injected_user_message(&text) {
                                title = Some(normalize_title(&text, 120));
                            }
                        }
                    }
                }
            }
            // 老版本 CLI（约 2026-06 及以前）没有 thread_settings_applied 事件，
            // 模型名写在 turn_context 的 payload.model。
            Some("turn_context") => {
                if let Some(timestamp) = event
                    .get("timestamp")
                    .and_then(Value::as_str)
                    .and_then(rfc3339_timestamp_millis)
                {
                    turn_account = Some(active_period_account(periods, timestamp));
                }
                if let Some(model) = event
                    .get("payload")
                    .and_then(|p| p.get("model"))
                    .and_then(Value::as_str)
                {
                    let model = model.trim();
                    if !model.is_empty() {
                        summary.model = Some(model.to_string());
                    }
                }
            }
            Some("event_msg") => {
                let payload = event.get("payload");
                match payload.and_then(|p| p.get("type")).and_then(Value::as_str) {
                    Some("task_started") => {
                        turn_account = event
                            .get("timestamp")
                            .and_then(Value::as_str)
                            .and_then(rfc3339_timestamp_millis)
                            .map(|timestamp| active_period_account(periods, timestamp));
                    }
                    Some("token_count") => {
                        let timestamp = event
                            .get("timestamp")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string();

                        // rate_limits 与 token_count 同一事件返回，不产生任何额外请求。
                        let rate_limit =
                            payload.and_then(|p| p.get("rate_limits")).and_then(|rl| {
                                let primary = rl
                                    .get("primary")
                                    .and_then(parse_session_rate_limit_window)?;
                                Some(RateLimitSnapshot {
                                    used_percent: primary.used_percent?,
                                    window_minutes: primary.window_minutes,
                                    resets_at: primary.resets_at,
                                    secondary: rl
                                        .get("secondary")
                                        .and_then(parse_session_rate_limit_window),
                                    plan_type: rl
                                        .get("plan_type")
                                        .and_then(Value::as_str)
                                        .map(str::to_string),
                                    timestamp: timestamp.clone(),
                                })
                            });
                        if let Some(rate_limit) = rate_limit {
                            let account_id = turn_account.clone().unwrap_or_else(|| {
                                rfc3339_timestamp_millis(&timestamp)
                                    .and_then(|ts| active_period_account(periods, ts))
                            });
                            if let Some(account_id) = account_id {
                                summary.account_usage.push((account_id, rate_limit));
                            }
                        }
                        let info = payload.and_then(|p| p.get("info"));
                        let current = info
                            .and_then(|value| value.get("total_token_usage"))
                            .map(TokenUsageSnapshot::from_value);
                        let last = info
                            .and_then(|value| value.get("last_token_usage"))
                            .map(TokenUsageSnapshot::from_value);

                        let cumulative_delta = current.as_ref().map(|usage| match &prev_usage {
                            Some(previous) => usage.delta(previous),
                            None => usage.clone(),
                        });
                        let counter_rolled_back = match (&current, &prev_usage) {
                            (Some(usage), Some(previous)) => usage.total < previous.total,
                            _ => false,
                        };
                        // last_token_usage 能处理累计计数器换 epoch；正常情况下只有当它与
                        // 累计差分一致时才采用，避免重复 token_count 把同一 turn 计算两次。
                        let duplicate = !seen_usage_events
                            .insert((timestamp.clone(), info.map(Value::to_string)));
                        let delta = if duplicate {
                            TokenUsageSnapshot::default()
                        } else {
                            match (last, cumulative_delta) {
                                (Some(last), Some(_)) if counter_rolled_back => last,
                                (Some(last), Some(diff))
                                    if last.total == diff.total
                                        && last.input == diff.input
                                        && last.cached_input == diff.cached_input
                                        && last.output == diff.output
                                        && last.reasoning == diff.reasoning =>
                                {
                                    last
                                }
                                (_, Some(diff)) => diff,
                                (Some(last), None) => last,
                                (None, None) => TokenUsageSnapshot::default(),
                            }
                        };
                        if !duplicate {
                            if let Some(current) = current {
                                prev_usage = Some(current);
                            }
                        }

                        // 会话总量也按事件增量累加，累计计数器回退时不会丢失历史消耗。
                        summary.input_tokens += delta.input;
                        summary.cached_input_tokens += delta.cached_input;
                        summary.output_tokens += delta.output;
                        summary.reasoning_tokens += delta.reasoning;
                        summary.total_tokens += delta.total;

                        let Some(date) = utc_ts_to_local_date(&timestamp) else {
                            continue;
                        };
                        if !delta.is_zero() {
                            let entry = summary.daily.entry(date).or_default();
                            entry.input_tokens += delta.input;
                            entry.cached_input_tokens += delta.cached_input;
                            entry.output_tokens += delta.output;
                            entry.reasoning_tokens += delta.reasoning;
                            entry.total_tokens += delta.total;
                        }
                    }
                    Some("thread_settings_applied") => {
                        if let Some(model) = payload
                            .and_then(|p| p.get("thread_settings"))
                            .and_then(|settings| settings.get("model"))
                            .and_then(Value::as_str)
                        {
                            let model = model.trim();
                            if !model.is_empty() {
                                summary.model = Some(model.to_string());
                            }
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
    if let Some(title) = title {
        summary.title = title;
    }
    summary
}

/// 项目展示名：cwd 的末级目录名；cwd 为空时归为「未指定目录」。
pub(crate) fn project_display_name(path: &str) -> String {
    if path.trim().is_empty() {
        return "未指定目录".to_string();
    }
    PathBuf::from(path)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| path.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sessions::test_support::{
        meta_line, response_item_line, thread_settings_line, token_count_line, token_count_line_ts,
        token_count_line_with_dual_rate_limit, token_count_line_with_rate_limit,
    };

    #[test]
    fn parse_session_meta_extracts_fields() {
        let meta = parse_session_meta(&meta_line("/Users/u/Projects/demo")).unwrap();
        assert_eq!(meta.id, "sess-001");
        assert_eq!(meta.project_path, "/Users/u/Projects/demo");
        assert_eq!(meta.started_at, "2026-08-11T09:10:42.358Z");
        assert_eq!(meta.cli_version.as_deref(), Some("0.147.0"));
        assert_eq!(meta.model_provider.as_deref(), Some("openai"));
    }

    #[test]
    fn parse_session_meta_rejects_non_meta_line() {
        assert!(parse_session_meta(r#"{"type":"event_msg","payload":{}}"#).is_none());
    }

    #[test]
    fn parse_session_meta_legacy_format_without_payload() {
        // 2025-09 之前的旧格式：首行无 type/payload。
        let meta = parse_session_meta(
            r#"{"id":"56c862da-342c-47ba-abdf-75125b8862ba","timestamp":"2025-09-05T11:05:23.343Z","instructions":null}"#,
        )
        .unwrap();
        assert_eq!(meta.id, "56c862da-342c-47ba-abdf-75125b8862ba");
        assert_eq!(meta.started_at, "2025-09-05T11:05:23.343Z");
        assert!(meta.project_path.is_empty());
        assert!(meta.cli_version.is_none());
        // 非元数据行（如 state 记录）不应被误认为会话元数据。
        assert!(parse_session_meta(r#"{"record_type":"state"}"#).is_none());
    }

    #[test]
    fn extract_cwd_from_environment_context() {
        let content = r#"{"record_type":"state"}
{"type":"message","role":"user","content":[{"type":"input_text","text":"<environment_context>\n  <cwd>/Users/u/Projects/front-test</cwd>\n  <approval_policy>on-request</approval_policy>\n</environment_context>"}]}"#;
        assert_eq!(
            extract_cwd_from_content(content),
            "/Users/u/Projects/front-test"
        );
        assert_eq!(extract_cwd_from_content("no cwd here"), "");
    }

    #[test]
    fn extract_title_skips_instructions_injection() {
        let lines = vec![
            meta_line("/tmp/p"),
            response_item_line(
                "user",
                "<user_instructions>\n > Behavioral Guidelines for Intelligent Programming Assistants",
            ),
            response_item_line(
                "user",
                "<environment_context>\n  <cwd>/tmp/p</cwd>\n</environment_context>",
            ),
            response_item_line("user", "把登录接口的鉴权逻辑改一下"),
        ];
        let parsed = extract_session_summary(&lines, &[]);
        assert_eq!(parsed.title, "把登录接口的鉴权逻辑改一下");
    }

    #[test]
    fn extract_title_skips_agents_injection() {
        let lines = vec![
            meta_line("/tmp/p"),
            response_item_line(
                "user",
                "# AGENTS.md instructions\n\n<INSTRUCTIONS>\nSkill policy",
            ),
            response_item_line("developer", "thinking..."),
            response_item_line("user", "分析下这里为什么 tips 没生效，并给出修复方案"),
        ];
        let parsed = extract_session_summary(&lines, &[]);
        assert_eq!(parsed.title, "分析下这里为什么 tips 没生效，并给出修复方案");
        assert_eq!(parsed.message_count, 3);
    }

    #[test]
    fn extract_title_normalizes_whitespace_and_truncates() {
        let long = format!("第一行\n\n  第二行   {:0<200}", "x");
        let lines = vec![meta_line("/tmp/p"), response_item_line("user", &long)];
        let parsed = extract_session_summary(&lines, &[]);
        assert!(
            !parsed.title.contains('\n'),
            "标题应压缩空白: {}",
            parsed.title
        );
        assert!(
            parsed.title.chars().count() <= 121,
            "标题应截断: {}",
            parsed.title.len()
        );
        assert!(parsed.title.ends_with('…'));
    }

    #[test]
    fn extract_title_falls_back_to_unnamed() {
        let lines = vec![
            meta_line("/tmp/p"),
            response_item_line("developer", "no user message here"),
        ];
        let parsed = extract_session_summary(&lines, &[]);
        assert_eq!(parsed.title, "未命名会话");
        assert_eq!(parsed.message_count, 1);
    }

    #[test]
    fn extract_title_uses_first_real_user_message() {
        let lines = vec![
            meta_line("/tmp/p"),
            response_item_line("user", "# AGENTS.md instructions"),
            response_item_line("user", "真实的第一个需求"),
            response_item_line("user", "后续消息不应覆盖标题"),
        ];
        let parsed = extract_session_summary(&lines, &[]);
        assert_eq!(parsed.title, "真实的第一个需求");
    }

    #[test]
    fn extract_tokens_takes_last_accumulated_count() {
        let lines = vec![
            meta_line("/tmp/p"),
            thread_settings_line("gpt-5.6-sol"),
            response_item_line("user", "帮我加一个功能"),
            token_count_line(100, 50, 10, 160),
            token_count_line(1000, 200, 80, 1280),
            token_count_line(5000, 600, 300, 5900),
        ];
        let parsed = extract_session_summary(&lines, &[]);
        assert_eq!(parsed.model.as_deref(), Some("gpt-5.6-sol"));
        // 取最后一个 token_count 事件的累计值。
        assert_eq!(parsed.input_tokens, 5000);
        assert_eq!(parsed.cached_input_tokens, 2500);
        assert_eq!(parsed.output_tokens, 600);
        assert_eq!(parsed.reasoning_tokens, 300);
        assert_eq!(parsed.total_tokens, 5900);
    }

    #[test]
    fn extract_tokens_defaults_when_missing() {
        let lines = vec![meta_line("/tmp/p"), response_item_line("user", "hi")];
        let parsed = extract_session_summary(&lines, &[]);
        assert_eq!(parsed.total_tokens, 0);
        assert!(parsed.model.is_none());
    }

    #[test]
    fn extract_model_from_legacy_turn_context() {
        // 老版本 CLI：无 thread_settings_applied，模型名在 turn_context.payload.model。
        let lines = vec![
            meta_line("/tmp/p"),
            serde_json::json!({
                "timestamp": "2026-06-01T02:00:00.000Z",
                "ordinal": 1,
                "type": "turn_context",
                "payload": {
                    "turn_id": "turn-1",
                    "cwd": "/tmp/p",
                    "model": "gpt-5.5",
                    "personality": "pragmatic"
                }
            })
            .to_string(),
            response_item_line("user", "帮我加个功能"),
        ];
        let parsed = extract_session_summary(&lines, &[]);
        assert_eq!(parsed.model.as_deref(), Some("gpt-5.5"));
    }

    #[test]
    fn extract_daily_tokens_splits_across_days() {
        // 两天前累计 500/1500 → 昨天累计 1900 → 今天累计 2550：
        // 差分后各日期增量 = 1900 / (2550-1900=650)… 但日期归属取决于本地时区，
        // 用同一转换函数算出期望日期键再断言，验证差分逻辑本身。
        let lines = vec![
            meta_line("/tmp/p"),
            token_count_line_ts("2026-08-11T10:00:00Z", 500, 100, 50, 650),
            token_count_line_ts("2026-08-11T11:00:00Z", 1500, 300, 100, 1900),
            token_count_line_ts("2026-08-12T09:00:00Z", 2000, 400, 150, 2550),
        ];
        let parsed = extract_session_summary(&lines, &[]);
        let day1 = utc_ts_to_local_date("2026-08-11T11:00:00Z").unwrap();
        let day2 = utc_ts_to_local_date("2026-08-12T09:00:00Z").unwrap();

        let d1 = parsed.daily.get(&day1).expect("第一天应有增量");
        assert_eq!(d1.total_tokens, 1900);
        assert_eq!(d1.input_tokens, 1500);
        assert_eq!(d1.output_tokens, 300);
        assert_eq!(d1.reasoning_tokens, 100);

        let d2 = parsed.daily.get(&day2).expect("第二天应有增量");
        // 第二天 = 最后累计值 2550 - 前一天累计 1900。
        assert_eq!(d2.total_tokens, 650);
        assert_eq!(d2.input_tokens, 500);
        assert_eq!(d2.output_tokens, 100);
        assert_eq!(d2.reasoning_tokens, 50);

        // 会话总累计值 = 最后一条。
        assert_eq!(parsed.total_tokens, 2550);
    }

    #[test]
    fn extract_daily_tokens_starts_new_epoch_after_counter_reset() {
        // 累计值回退代表计数器进入新 epoch：当前值应作为本次增量，不能吞成 0。
        let lines = vec![
            meta_line("/tmp/p"),
            token_count_line_ts("2026-08-11T10:00:00Z", 1500, 300, 100, 1900),
            token_count_line_ts("2026-08-11T11:00:00Z", 1000, 200, 50, 1250),
        ];
        let parsed = extract_session_summary(&lines, &[]);
        let day = utc_ts_to_local_date("2026-08-11T11:00:00Z").unwrap();
        let d = parsed.daily.get(&day).unwrap();
        // 第一段 1900 + 新 epoch 首条 1250。
        assert_eq!(d.total_tokens, 3150);
        assert_eq!(d.input_tokens, 2500);
        assert_eq!(parsed.total_tokens, 3150);
    }

    #[test]
    fn extract_tokens_prefers_last_usage_when_counter_epoch_changes() {
        let reset_with_last = serde_json::json!({
            "timestamp": "2026-08-11T11:00:00Z",
            "type": "event_msg",
            "payload": {
                "type": "token_count",
                "info": {
                    "total_token_usage": {
                        "input_tokens": 1000,
                        "cached_input_tokens": 500,
                        "output_tokens": 200,
                        "reasoning_output_tokens": 50,
                        "total_tokens": 1250
                    },
                    "last_token_usage": {
                        "input_tokens": 200,
                        "cached_input_tokens": 100,
                        "output_tokens": 30,
                        "reasoning_output_tokens": 20,
                        "total_tokens": 250
                    }
                }
            }
        })
        .to_string();
        let lines = vec![
            meta_line("/tmp/p"),
            token_count_line_ts("2026-08-11T10:00:00Z", 1500, 300, 100, 1900),
            reset_with_last,
        ];
        let parsed = extract_session_summary(&lines, &[]);
        assert_eq!(parsed.total_tokens, 2150);
        assert_eq!(parsed.input_tokens, 1700);
        assert_eq!(parsed.output_tokens, 330);
        assert_eq!(parsed.reasoning_tokens, 120);
    }

    #[test]
    fn extract_rate_limit_takes_last_snapshot() {
        let lines = vec![
            meta_line("/tmp/p"),
            token_count_line_with_rate_limit("2026-08-14T02:51:00Z", 63.0, "team"),
            token_count_line_with_rate_limit("2026-08-14T03:20:00Z", 71.0, "team"),
        ];
        let periods = [ActivePeriod {
            account_id: "acc-a".to_string(),
            started_millis: 0,
            ended_millis: None,
        }];
        let mut parsed = extract_session_summary(&lines, &periods);
        let (account_id, rl) = parsed.account_usage.pop().expect("应提取到额度快照");
        assert_eq!(account_id, "acc-a");
        assert_eq!(rl.used_percent, 71.0);
        assert_eq!(rl.window_minutes, Some(10080));
        assert_eq!(rl.resets_at, Some(1787134079));
        assert_eq!(rl.plan_type.as_deref(), Some("team"));
        assert_eq!(rl.timestamp, "2026-08-14T03:20:00Z");
    }

    #[test]
    fn extract_rate_limit_none_without_token_count() {
        let lines = vec![meta_line("/tmp/p"), response_item_line("user", "hi")];
        let parsed = extract_session_summary(&lines, &[]);
        assert!(parsed.account_usage.is_empty());
    }

    #[test]
    fn extract_rate_limit_takes_secondary_window() {
        let lines = vec![
            meta_line("/tmp/p"),
            token_count_line_with_dual_rate_limit("2026-08-26T05:36:06Z", 4.0, Some(15.0)),
        ];
        let periods = [ActivePeriod {
            account_id: "acc-a".to_string(),
            started_millis: 0,
            ended_millis: None,
        }];
        let mut parsed = extract_session_summary(&lines, &periods);
        let (account_id, rl) = parsed.account_usage.pop().expect("应提取到额度快照");
        assert_eq!(account_id, "acc-a");
        assert_eq!(rl.used_percent, 4.0);
        assert_eq!(rl.window_minutes, Some(300));
        let secondary = rl.secondary.expect("应提取到周限窗口");
        assert_eq!(secondary.used_percent, Some(15.0));
        assert_eq!(secondary.window_minutes, Some(10080));
        assert_eq!(secondary.resets_at, Some(1788313023));
    }

    #[test]
    fn extract_rate_limit_secondary_null_is_none() {
        let lines = vec![
            meta_line("/tmp/p"),
            token_count_line_with_dual_rate_limit("2026-08-26T05:36:06Z", 4.0, None),
        ];
        let periods = [ActivePeriod {
            account_id: "acc-a".to_string(),
            started_millis: 0,
            ended_millis: None,
        }];
        let mut parsed = extract_session_summary(&lines, &periods);
        let (account_id, rl) = parsed.account_usage.pop().expect("应提取到额度快照");
        assert_eq!(account_id, "acc-a");
        assert_eq!(rl.used_percent, 4.0);
        assert!(rl.secondary.is_none());
    }

    #[test]
    fn session_usage_follows_turn_account_after_switch() {
        let periods = vec![
            ActivePeriod {
                account_id: "a".to_string(),
                started_millis: 0,
                ended_millis: Some(1500),
            },
            ActivePeriod {
                account_id: "b".to_string(),
                started_millis: 1500,
                ended_millis: None,
            },
        ];
        let started = |timestamp: &str| {
            serde_json::json!({"type":"event_msg", "timestamp":timestamp, "payload":{"type":"task_started"}}).to_string()
        };
        let lines = vec![
            started("1970-01-01T00:00:01Z"),
            thread_settings_line("gpt-6-astra"),
            token_count_line_with_rate_limit("1970-01-01T00:00:02Z", 10.0, "plus"),
            started("1970-01-01T00:00:03Z"),
            thread_settings_line("gpt-5.6-terra"),
            token_count_line_with_rate_limit("1970-01-01T00:00:04Z", 20.0, "team"),
        ];
        let parsed = extract_session_summary(&lines, &periods);
        assert_eq!(parsed.account_usage.len(), 2);
        assert_eq!(parsed.account_usage[0].0, "a");
        assert_eq!(parsed.account_usage[0].1.used_percent, 10.0);
        assert_eq!(parsed.account_usage[1].0, "b");
        assert_eq!(parsed.account_usage[1].1.used_percent, 20.0);
        assert_eq!(parsed.model.as_deref(), Some("gpt-5.6-terra"));
        assert_eq!(active_period_account(&periods, 1499).as_deref(), Some("a"));
        assert_eq!(active_period_account(&periods, 1500).as_deref(), Some("b"));
    }

    #[test]
    fn duplicate_last_only_usage_is_counted_once() {
        let event = serde_json::json!({"type":"event_msg", "timestamp":"1970-01-01T00:00:01Z", "payload":{
            "type":"token_count", "info":{"last_token_usage":{"input_tokens":100,"output_tokens":10,"total_tokens":110}}
        }}).to_string();
        let parsed = extract_session_summary(&[event.clone(), event], &[]);
        assert_eq!(parsed.total_tokens, 110);
    }

    #[test]
    fn utc_ts_to_local_date_returns_ymd() {
        let date = utc_ts_to_local_date("2026-08-12T09:00:00Z").unwrap();
        assert_eq!(date.len(), 10);
        assert_eq!(&date[4..5], "-");
        assert_eq!(&date[7..8], "-");
        assert!(utc_ts_to_local_date("not-a-time").is_none());
    }

    #[test]
    fn project_name_from_basename() {
        assert_eq!(
            project_display_name("/Users/u/Projects/apcp-web-api"),
            "apcp-web-api"
        );
        assert_eq!(project_display_name("/"), "/");
        assert_eq!(project_display_name(""), "未指定目录");
        assert_eq!(project_display_name("   "), "未指定目录");
    }
}
