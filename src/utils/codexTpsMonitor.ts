import type { CodexLiveTps } from '../types/codexEvents';
import { rpcRecord } from './codexAppServer';

interface TurnSample {
  id: string;
  startedAt: number;
  baseline: number | null;
  outputTokens: number | null;
  durationMs: number | null;
  running: boolean;
  invalid: boolean;
  activity: number;
}

interface TokenCounter {
  turnId: string;
  outputTokens: number;
}

interface TpsOptions {
  accountId: string | null;
  isLive: () => boolean;
  observesThread: (id: string) => boolean;
  isSubscribed: (id: string) => boolean;
  onChange: (snapshot: CodexLiveTps) => void;
}

export function emptyCodexTps(accountId: string | null = null): CodexLiveTps {
  return { accountId, threadId: null, tokensPerSecond: null, outputTokens: null,
    durationMs: null, status: 'waiting' };
}

function id(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

// 使用累计输出差值，重复推送不重复计数；不把 last（单次响应）误当成整轮用量。
// 只测量连接后观察到的完整轮次，不读取历史，不向后端发送 TPS。
export function createCodexTpsMonitor(options: TpsOptions) {
  const attachedAt = Date.now();
  const counters = new Map<string, TokenCounter>();
  const turns = new Map<string, TurnSample>();
  let sequence = 0;
  let stopped = false;
  let previous = emptyCodexTps(options.accountId);
  let timer: ReturnType<typeof setInterval> | undefined;

  const live = () => !stopped && options.isLive() && options.accountId !== null;
  const publish = () => {
    if (!live()) return;
    // 并发会话不相加成“模型速度”；优先最近活跃且尚未结束的轮次。
    let selected: [string, TurnSample] | null = null;
    for (const entry of turns) {
      if (!options.observesThread(entry[0])) continue;
      if (!selected || (entry[1].running && !selected[1].running)
        || (entry[1].running === selected[1].running && entry[1].activity > selected[1].activity)) selected = entry;
    }
    const next = emptyCodexTps(options.accountId);
    if (selected) {
      const [threadId, turn] = selected;
      const elapsed = turn.running ? performance.now() - turn.startedAt : turn.durationMs;
      next.threadId = threadId;
      next.status = turn.running ? 'measuring' : 'completed';
      if (!turn.invalid && turn.outputTokens !== null && elapsed !== null && elapsed > 0) {
        const rate = turn.outputTokens * 1000 / elapsed;
        if (Number.isFinite(rate)) {
          next.tokensPerSecond = Math.round(rate * 10) / 10;
          next.outputTokens = turn.outputTokens;
          next.durationMs = Math.round(elapsed);
        }
      }
    }
    if (next.threadId === previous.threadId && next.tokensPerSecond === previous.tokensPerSecond
      && next.outputTokens === previous.outputTokens && next.durationMs === previous.durationMs
      && next.status === previous.status) return;
    previous = next;
    options.onChange(next);
  };

  const updateTimer = () => {
    const running = [...turns.values()].some(turn => turn.running);
    if (running && !timer) timer = setInterval(publish, 1000); // 仅刷新内存计时，不发请求。
    else if (!running && timer) { clearInterval(timer); timer = undefined; }
  };

  const remove = (threadId: string) => {
    counters.delete(threadId);
    turns.delete(threadId);
  };

  return {
    notify(method: string, params: Record<string, unknown>) {
      if (!live()) return;
      const threadId = id(params.threadId);
      if (!threadId) return;
      if (method === 'thread/closed' || method === 'thread/archived' || method === 'thread/deleted') {
        remove(threadId);
        updateTimer();
        publish();
        return;
      }
      if (!options.observesThread(threadId)) return;
      if (method === 'turn/started') {
        const turn = rpcRecord(params.turn);
        const turnId = id(turn?.id);
        const previousTurn = turns.get(threadId);
        if (!turn || !turnId || previousTurn?.id === turnId || !options.isSubscribed(threadId)) return;
        const startedAt = positive(turn.startedAt);
        // 接入响应确认后才开始计时；秒级原生时间只用于排除旧轮次回放。
        if (startedAt !== null && (startedAt < Math.floor(attachedAt / 1000) || startedAt * 1000 > Date.now())) return;
        const counter = counters.get(threadId);
        // 没有基线，或已收到本轮用量才见到开始事件时，不猜测零基线。
        const baseline = previousTurn?.running || counter?.turnId === turnId ? null : counter?.outputTokens ?? null;
        turns.set(threadId, { id: turnId, startedAt: performance.now(),
          baseline, outputTokens: null, durationMs: null,
          running: true, invalid: false, activity: ++sequence });
      } else if (method === 'thread/tokenUsage/updated') {
        const turnId = id(params.turnId);
        const usage = rpcRecord(params.tokenUsage);
        const total = count(rpcRecord(usage?.total)?.outputTokens);
        if (!turnId || total === null) return;
        const prior = counters.get(threadId)?.outputTokens;
        const turn = turns.get(threadId);
        // 订阅时重放的旧 token 用量只建立计数基线，不产生历史 TPS。
        if (!turn) {
          counters.set(threadId, { turnId, outputTokens: total });
          return;
        }
        if (turnId !== turn.id) {
          // 迟到的其他轮次用量不能覆盖当前计数；上升则说明基线不完整。
          if (turn.running) {
            if (prior !== undefined && total > prior) { turn.invalid = true; turn.outputTokens = null; }
          } else if (prior === undefined || total > prior) {
            counters.set(threadId, { turnId, outputTokens: total });
            turns.delete(threadId);
          }
          updateTimer();
          publish();
          return;
        }
        counters.set(threadId, { turnId, outputTokens: total });
        if (prior !== undefined && total < prior) { turn.invalid = true; turn.outputTokens = null; }
        if (turn.baseline === null && total === 0) turn.baseline = 0;
        if (!turn.invalid && turn.baseline !== null) {
          if (total < turn.baseline) { turn.invalid = true; turn.outputTokens = null; }
          else turn.outputTokens = total - turn.baseline;
        }
        if (prior !== total) turn.activity = ++sequence;
      } else if (method === 'turn/completed') {
        const event = rpcRecord(params.turn);
        const turn = turns.get(threadId);
        if (!event || !turn || id(event.id) !== turn.id || !turn.running) return;
        turn.running = false;
        // 原生毫秒耗时优先；旧版本使用本连接观察到的单调时钟计时。
        turn.durationMs = positive(event.durationMs) ?? positive(performance.now() - turn.startedAt);
        if (event.status !== 'completed') { turn.invalid = true; turn.outputTokens = null; }
        turn.activity = ++sequence;
      } else if (method === 'thread/status/changed') {
        const status = rpcRecord(params.status);
        if (params.status === 'notLoaded' || status?.type === 'notLoaded') remove(threadId);
        else return;
      } else if (method.startsWith('item/')) {
        const turn = turns.get(threadId);
        if (!turn || !turn.running || id(params.turnId) !== turn.id) return;
        turn.activity = ++sequence;
        return; // 文本分片只标记最近活动，TPS 由本地计时器统一刷新。
      } else return;
      updateTimer();
      publish();
    },
    prune() {
      if (!live()) return;
      for (const threadId of counters.keys()) if (!options.observesThread(threadId)) remove(threadId);
      for (const threadId of turns.keys()) if (!options.observesThread(threadId)) remove(threadId);
      updateTimer();
      publish();
    },
    stop() {
      stopped = true;
      clearInterval(timer);
      timer = undefined;
      counters.clear();
      turns.clear();
    },
  };
}
