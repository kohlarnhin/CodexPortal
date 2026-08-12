import { SessionPreviewMessage } from '../types/session';

/** 注入型用户消息（AGENTS.md / Skill 指令模板），预览时跳过。 */
function isInjectedUserMessage(text: string): boolean {
  const trimmed = text.trimStart();
  return (
    trimmed.startsWith('# AGENTS.md') ||
    trimmed.includes('<INSTRUCTIONS>') ||
    trimmed.startsWith('# Skills')
  );
}

interface JsonlEvent {
  type?: string;
  payload?: {
    type?: string;
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
  };
}

/**
 * 从会话 JSONL 原文中提取用户/助手消息：
 * - 仅保留 response_item 中 role 为 user / assistant 的文本消息；
 * - 跳过 AGENTS.md / Skill 指令注入；
 * - 内容已全量入库，单条消息与消息数量均不截断，完整展示。
 */
export function parseSessionPreview(content: string): SessionPreviewMessage[] {
  const messages: SessionPreviewMessage[] = [];

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;

    let event: JsonlEvent;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type !== 'response_item') continue;
    const payload = event.payload;
    if (!payload || payload.type !== 'message') continue;
    if (payload.role !== 'user' && payload.role !== 'assistant') continue;

    const text = (payload.content || [])
      .map(part => part.text || '')
      .filter(Boolean)
      .join('\n')
      .trim();
    if (!text) continue;
    if (payload.role === 'user' && isInjectedUserMessage(text)) continue;

    messages.push({
      role: payload.role,
      text,
    });
  }

  return messages;
}
