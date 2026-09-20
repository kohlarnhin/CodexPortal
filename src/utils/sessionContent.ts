import type { SessionEntry } from '../types/session';

/** 指令注入仍保留在时间线中，只默认折叠。 */
function isInjectedUserMessage(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith('# AGENTS.md')
    || trimmed.includes('<INSTRUCTIONS>')
    || trimmed.startsWith('# Skills');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** 工具参数/结果可能是 JSON 字符串，展开后保留命令和代码中的实际换行。 */
function decodeToolValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object' ? parsed : value;
  } catch {
    return value;
  }
}

/** 可读的字段展示，不截断字段、长文本或数组；精确原文另存于 raw。 */
function formatValue(value: unknown): string {
  if (typeof value === 'string') return value || '""';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value.map((item, index) => `[${index + 1}]\n${formatValue(item)}`).join('\n\n');
  }
  const record = asRecord(value);
  if (record) {
    const fields = Object.entries(record);
    if (fields.length === 0) return '{}';
    return fields.map(([key, item]) => {
      const formatted = formatValue(
        key === 'arguments' || key === 'input' || key === 'output' ? decodeToolValue(item) : item,
      );
      return formatted.includes('\n') ? `${key}:\n${formatted}` : `${key}: ${formatted}`;
    }).join('\n\n');
  }
  return JSON.stringify(value) ?? '';
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(part => {
    if (typeof part === 'string') return part;
    return asString(asRecord(part)?.text) ?? '';
  }).filter(text => text.length > 0).join('\n');
}

const EVENT_TITLES: Record<string, string> = {
  session_meta: '会话信息',
  turn_context: '轮次上下文',
  compacted: '上下文压缩',
  reasoning: '推理记录',
  user_message: '用户消息事件',
  agent_message: '助手消息事件',
  agent_reasoning: '推理事件',
  token_count: 'Token 与额度记录',
  task_started: '任务开始',
  task_complete: '任务完成',
  turn_aborted: '轮次中断',
  thread_settings_applied: '会话配置',
};

/** 每个非空 JSONL 行都保留，包括未知事件和无法解析的行；不限制条数或正文长度。 */
export function parseSessionContent(content: string): SessionEntry[] {
  const entries: SessionEntry[] = [];
  const toolNames = new Map<string, string>();

  for (const [index, line] of content.split('\n').entries()) {
    if (!line.trim()) continue;
    const entry: SessionEntry = {
      id: `line-${index + 1}`,
      role: 'system',
      title: '原始记录',
      timestamp: null,
      text: line,
      raw: line,
      defaultCollapsed: true,
    };
    entries.push(entry);

    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      entry.title = '未解析记录';
      continue;
    }

    const event = asRecord(value);
    const payload = asRecord(event?.payload);
    const eventType = asString(event?.type) ?? '未知类型';
    const payloadType = asString(payload?.type) ?? '';
    entry.timestamp = asString(event?.timestamp);
    const type = payloadType || eventType;
    entry.title = Object.prototype.hasOwnProperty.call(EVENT_TITLES, type)
      ? EVENT_TITLES[type] : `记录 · ${type}`;
    try {
      entry.text = formatValue(value);
    } catch {
      // 极深或异常结构也保留原文，不让单条记录阻断整个会话。
      entry.text = line;
    }

    if (eventType !== 'response_item' || !payload) continue;

    if (payloadType === 'message') {
      const role = asString(payload.role);
      const text = messageText(payload.content);
      if (text.length > 0) entry.text = text;
      if (role === 'user' || role === 'assistant') {
        entry.role = role;
        const injected = role === 'user' && isInjectedUserMessage(text);
        entry.title = injected ? '用户指令 / 上下文' : role === 'user' ? '用户' : 'Codex';
        entry.defaultCollapsed = injected || !text.trim();
      } else {
        entry.title = role === 'developer' ? '开发者指令'
          : role === 'system' ? '系统指令' : `消息 · ${role ?? '未知角色'}`;
      }
      continue;
    }

    const callId = asString(payload.call_id);
    const toolName = asString(payload.name) ?? (callId ? toolNames.get(callId) : undefined);
    if (payloadType === 'function_call' || payloadType === 'custom_tool_call') {
      entry.role = 'tool';
      entry.title = `工具调用${toolName ? ` · ${toolName}` : ''}`;
      if (callId && toolName) toolNames.set(callId, toolName);
    } else if (payloadType === 'function_call_output' || payloadType === 'custom_tool_call_output') {
      entry.role = 'tool';
      entry.title = `工具结果${toolName ? ` · ${toolName}` : ''}`;
    }
  }

  return entries;
}
