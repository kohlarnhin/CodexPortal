use super::ipc;
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};

fn error(id: Value, code: i32, message: &str) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}})
}

fn tools() -> Value {
    json!({"tools": [
        {
            "name": "get_status",
            "description": "查看 Codex Portal 当前使用的 Codex 账号、短周期和长周期窗口的剩余额度与重置时间、下一接替账号，以及是否所有账号额度都已耗尽。只读，基于 Portal 最新记录的额度。",
            "inputSchema": {"type": "object", "properties": {}},
            "annotations": {"readOnlyHint": true}
        },
        {
            "name": "switch_account",
            "description": "当 Codex 因额度耗尽无法继续时调用。Portal 先通过官方 API 查询当前账号的实时额度，再由智能调度决定是否切换：优先使用最早到期的额度，当前账号仍可用时通常不切换。返回是否发生切换及切换后的账号额度。",
            "inputSchema": {"type": "object", "properties": {}}
        }
    ]})
}

pub(super) fn handle(message: &Value, call: impl Fn(&str) -> Result<Value, String>) -> Option<Value> {
    let id = message.get("id")?;
    let method = message.get("method")?.as_str()?;
    let result = match method {
        "initialize" => json!({
            "protocolVersion": message["params"]["protocolVersion"].as_str().unwrap_or("2025-06-18"),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "codex-portal", "version": env!("CARGO_PKG_VERSION")}
        }),
        "ping" => json!({}),
        "tools/list" => tools(),
        "tools/call" => {
            let command = match message["params"]["name"].as_str() {
                Some("get_status") => "status",
                Some("switch_account") => "switch",
                _ => return Some(error(id.clone(), -32602, "Unknown tool")),
            };
            match call(command) {
                Ok(value) => json!({"content": [{"type": "text", "text": serde_json::to_string_pretty(&value).unwrap()}]}),
                Err(message) => json!({"content": [{"type": "text", "text": message}], "isError": true}),
            }
        }
        _ => return Some(error(id.clone(), -32601, "Method not found")),
    };
    Some(json!({"jsonrpc": "2.0", "id": id, "result": result}))
}

fn handle_line(line: &str, call: impl Fn(&str) -> Result<Value, String>) -> Option<Value> {
    match serde_json::from_str(line) {
        Ok(message) => handle(&message, call),
        Err(_) => Some(error(Value::Null, -32700, "Parse error")),
    }
}

fn serve(input: impl BufRead, mut output: impl Write, call: impl Fn(&str) -> Result<Value, String>) -> io::Result<()> {
    for line in input.lines() {
        if let Some(response) = handle_line(&line?, &call) {
            serde_json::to_writer(&mut output, &response)?;
            output.write_all(b"\n")?;
            output.flush()?;
        }
    }
    Ok(())
}

pub(super) fn run() {
    let _ = serve(io::stdin().lock(), io::stdout().lock(), ipc::call);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no_call(_: &str) -> Result<Value, String> {
        panic!("this method must not call Portal");
    }

    #[test]
    fn initialize_echoes_requested_version_and_defaults_when_absent() {
        for version in [None, Some("2024-11-05"), Some("2025-06-18"), Some("future-version")] {
            let mut message = json!({"jsonrpc": "2.0", "id": 1, "method": "initialize"});
            if let Some(version) = version { message["params"] = json!({"protocolVersion": version}); }
            let response = handle(&message, no_call).unwrap();
            assert_eq!(response["id"], 1);
            assert_eq!(response["result"]["protocolVersion"], version.unwrap_or("2025-06-18"));
            assert_eq!(response["result"]["capabilities"], json!({"tools": {}}));
            assert_eq!(response["result"]["serverInfo"], json!({"name": "codex-portal", "version": env!("CARGO_PKG_VERSION")}));
        }
    }

    #[test]
    fn tools_list_has_both_tools_with_object_schemas_and_read_only_annotation() {
        let response = handle(&json!({"id": "list", "method": "tools/list"}), no_call).unwrap();
        let tools = response["result"]["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 2);
        for (tool, name) in tools.iter().zip(["get_status", "switch_account"]) {
            assert_eq!(tool["name"], name);
            assert_eq!(tool["inputSchema"], json!({"type": "object", "properties": {}}));
            assert!(!tool["description"].as_str().unwrap().is_empty());
        }
        assert_eq!(tools[0]["annotations"]["readOnlyHint"], true);
    }

    #[test]
    fn tool_calls_route_and_wrap_success_and_failure() {
        for (name, expected) in [("get_status", "status"), ("switch_account", "switch")] {
            let request = json!({"id": 2, "method": "tools/call", "params": {"name": name, "arguments": {}}});
            let value = json!({"current": {"name": "t***t@example.invalid"}, "switched": false});
            let response = handle(&request, |command| {
                assert_eq!(command, expected);
                Ok(value.clone())
            }).unwrap();
            let result = &response["result"];
            assert_eq!(result["content"][0]["type"], "text");
            assert_eq!(result["content"][0]["text"], serde_json::to_string_pretty(&value).unwrap());
            assert!(result.get("isError").is_none());
            let response = handle(&request, |command| {
                assert_eq!(command, expected);
                Err("查询失败".into())
            }).unwrap();
            assert_eq!(response["result"], json!({"content": [{"type": "text", "text": "查询失败"}], "isError": true}));
        }
    }

    #[test]
    fn notifications_and_messages_without_a_method_are_ignored() {
        for message in [
            json!({"method": "notifications/initialized"}),
            json!({"method": "tools/call", "params": {"name": "switch_account"}}),
            json!({"id": 1, "result": {}}),
        ] {
            assert_eq!(handle(&message, no_call), None);
        }
        assert_eq!(handle(&json!({"id": null, "method": "ping"}), no_call).unwrap(),
            json!({"jsonrpc": "2.0", "id": null, "result": {}}));
    }

    #[test]
    fn protocol_errors_use_json_rpc_codes() {
        let response = handle(&json!({"id": 3, "method": "unknown"}), no_call).unwrap();
        assert_eq!(response["error"]["code"], -32601);
        assert_eq!(response["id"], 3);
        let response = handle(&json!({"id": 4, "method": "tools/call", "params": {"name": "unknown"}}), no_call).unwrap();
        assert_eq!(response["error"]["code"], -32602);
        assert_eq!(response["id"], 4);
        let response = handle_line("{invalid", no_call).unwrap();
        assert_eq!(response["error"]["code"], -32700);
        assert_eq!(response["id"], Value::Null);
    }

    #[test]
    fn stdio_writes_only_one_json_line_per_response_and_continues_after_parse_errors() {
        let input = b"{\"method\":\"notifications/initialized\"}\ninvalid\n{\"id\":1,\"method\":\"ping\"}\n";
        let mut output = Vec::new();
        serve(&input[..], &mut output, no_call).unwrap();
        let output = String::from_utf8(output).unwrap();
        let responses: Vec<Value> = output.lines().map(|line| serde_json::from_str(line).unwrap()).collect();
        assert_eq!(responses.len(), 2);
        assert_eq!(responses[0]["error"]["code"], -32700);
        assert_eq!(responses[1], json!({"jsonrpc": "2.0", "id": 1, "result": {}}));
    }
}
