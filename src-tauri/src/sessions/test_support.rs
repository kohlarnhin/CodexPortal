pub(crate) fn meta_line(cwd: &str) -> String {
    serde_json::json!({
        "timestamp": "2026-08-11T09:10:42.358Z",
        "ordinal": 0,
        "type": "session_meta",
        "payload": {
            "session_id": "sess-001",
            "id": "sess-001",
            "timestamp": "2026-08-11T09:10:42.358Z",
            "cwd": cwd,
            "originator": "codex-tui",
            "cli_version": "0.147.0",
            "model_provider": "openai"
        }
    })
    .to_string()
}

pub(crate) fn response_item_line(role: &str, text: &str) -> String {
    serde_json::json!({
        "timestamp": "2026-08-11T09:11:00.000Z",
        "ordinal": 1,
        "type": "response_item",
        "payload": {
            "type": "message",
            "role": role,
            "content": [{"type": "input_text", "text": text}]
        }
    })
    .to_string()
}

pub(crate) fn token_count_line(input: i64, output: i64, reasoning: i64, total: i64) -> String {
    serde_json::json!({
        "timestamp": "2026-08-11T09:12:00.000Z",
        "ordinal": 20,
        "type": "event_msg",
        "payload": {
            "type": "token_count",
            "info": {
                "total_token_usage": {
                    "input_tokens": input,
                    "cached_input_tokens": input / 2,
                    "cache_write_input_tokens": 0,
                    "output_tokens": output,
                    "reasoning_output_tokens": reasoning,
                    "total_tokens": total
                },
                "model_context_window": 258400
            }
        }
    })
    .to_string()
}

pub(crate) fn token_count_line_ts(
    ts: &str,
    input: i64,
    output: i64,
    reasoning: i64,
    total: i64,
) -> String {
    serde_json::json!({
        "timestamp": ts,
        "ordinal": 20,
        "type": "event_msg",
        "payload": {
            "type": "token_count",
            "info": {
                "total_token_usage": {
                    "input_tokens": input,
                    "cached_input_tokens": input / 2,
                    "cache_write_input_tokens": 0,
                    "output_tokens": output,
                    "reasoning_output_tokens": reasoning,
                    "total_tokens": total
                },
                "model_context_window": 258400
            }
        }
    })
    .to_string()
}

pub(crate) fn thread_settings_line(model: &str) -> String {
    serde_json::json!({
        "timestamp": "2026-08-11T09:12:00.000Z",
        "ordinal": 21,
        "type": "event_msg",
        "payload": {
            "type": "thread_settings_applied",
            "thread_settings": { "model": model }
        }
    })
    .to_string()
}

pub(crate) fn token_count_line_with_rate_limit(ts: &str, used_percent: f64, plan: &str) -> String {
    serde_json::json!({
        "timestamp": ts,
        "ordinal": 20,
        "type": "event_msg",
        "payload": {
            "type": "token_count",
            "info": {
                "total_token_usage": {
                    "input_tokens": 1000,
                    "cached_input_tokens": 500,
                    "output_tokens": 100,
                    "reasoning_output_tokens": 50,
                    "total_tokens": 1150
                }
            },
            "rate_limits": {
                "limit_id": "codex",
                "primary": {
                    "used_percent": used_percent,
                    "window_minutes": 10080,
                    "resets_at": 1787134079
                },
                "plan_type": plan
            }
        }
    })
    .to_string()
}

/// 现网格式：primary = 5 小时窗口，secondary = 周限窗口（老版本 secondary 为 null）。
pub(crate) fn token_count_line_with_dual_rate_limit(
    ts: &str,
    primary_used: f64,
    secondary_used: Option<f64>,
) -> String {
    serde_json::json!({
        "timestamp": ts,
        "ordinal": 20,
        "type": "event_msg",
        "payload": {
            "type": "token_count",
            "info": {
                "total_token_usage": {
                    "input_tokens": 1000,
                    "cached_input_tokens": 500,
                    "output_tokens": 100,
                    "reasoning_output_tokens": 50,
                    "total_tokens": 1150
                }
            },
            "rate_limits": {
                "limit_id": "codex",
                "primary": {
                    "used_percent": primary_used,
                    "window_minutes": 300,
                    "resets_at": 1787726223
                },
                "secondary": secondary_used.map(|used| serde_json::json!({
                    "used_percent": used,
                    "window_minutes": 10080,
                    "resets_at": 1788313023
                })),
                "plan_type": "team"
            }
        }
    })
    .to_string()
}
