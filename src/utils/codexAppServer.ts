export function rpcRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export class CodexRpcError extends Error {
  constructor(
    readonly kind: 'closed' | 'timeout' | 'response' | 'invalidResponse',
    readonly code: number | null = null,
    readonly threadState: 'closing' | 'unavailable' | null = null,
  ) {
    // 不保留服务端错误正文；其中可能包含账号信息、目录或对话内容。
    super(`Codex RPC ${kind}`);
  }
}

interface PendingRequest {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: CodexRpcError) => void;
  timer: ReturnType<typeof setTimeout>;
}

// 每条连接独立关联请求、响应与超时；服务端发起的请求交由原会话客户端处理。
export function createCodexRpc(socket: WebSocket) {
  let sequence = 0;
  let closed = false;
  const pending = new Map<string, PendingRequest>();

  return {
    request(method: string, params: Record<string, unknown> = {}, timeoutMs = 20000) {
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        if (closed || socket.readyState !== WebSocket.OPEN) {
          reject(new CodexRpcError('closed'));
          return;
        }
        const id = `portal:${++sequence}`;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new CodexRpcError('timeout'));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        try {
          socket.send(JSON.stringify({ id, method, params }));
        } catch {
          clearTimeout(timer);
          pending.delete(id);
          reject(new CodexRpcError('closed'));
        }
      });
    },

    notify(method: string) {
      if (closed || socket.readyState !== WebSocket.OPEN) return false;
      try {
        socket.send(JSON.stringify({ method }));
        return true;
      } catch {
        return false;
      }
    },

    acceptResponse(message: Record<string, unknown>) {
      // 带 method 的消息是通知或服务端请求，不能与客户端请求 ID 混淆。
      if (message.method !== undefined || typeof message.id !== 'string') return false;
      const request = pending.get(message.id);
      if (!request) return false;
      pending.delete(message.id);
      clearTimeout(request.timer);
      const result = rpcRecord(message.result);
      if (message.error !== undefined || !result) {
        const error = rpcRecord(message.error);
        const code = typeof error?.code === 'number' && Number.isSafeInteger(error.code)
          ? error.code
          : null;
        const description = typeof error?.message === 'string' ? error.message : '';
        // 仅归类官方的固定错误格式，不保存或转发可能包含会话路径的原文。
        const threadState = /^thread \S+ is closing; retry thread\/resume/.test(description)
          ? 'closing'
          : description.startsWith('thread not found:') || description.startsWith('thread not loaded:')
            ? 'unavailable'
            : null;
        request.reject(new CodexRpcError(message.error !== undefined ? 'response' : 'invalidResponse', code, threadState));
      } else {
        request.resolve(result);
      }
      return true;
    },

    close() {
      closed = true;
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new CodexRpcError('closed'));
      }
      pending.clear();
    },
  };
}
