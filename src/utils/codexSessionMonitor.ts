import type { CodexActiveSession, CodexSessionMonitor } from '../types/codexEvents';
import { CodexRpcError, createCodexRpc, rpcRecord } from './codexAppServer';

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const DISCOVERY_INTERVAL_MS = 15000;

export type SubscriptionFailureReason = 'timeout' | 'threadClosing' | 'threadUnavailable' | 'rejected' | 'invalidResponse';
export type CodexSessionReport =
  | { kind: 'threadDiscoveryFailed' }
  | { kind: 'threadSubscriptions'; active: number; subscribed: number }
  | { kind: 'threadIdleReleased'; count: number }
  | { kind: 'threadSubscriptionFailed' | 'threadUnsubscriptionFailed'; count: number; reason: SubscriptionFailureReason; code: number | null };

interface TrackedSession extends CodexActiveSession {
  loaded: boolean;
  eligible: boolean;
  verified: boolean;
  activityObserved: boolean;
  updatedAt: number | null;
  revision: number;
}

type SessionSnapshot = Pick<CodexSessionMonitor, 'activeCount' | 'sessions' | 'isRefreshing' | 'discoveryFailed' | 'lastSyncedAt'>;
interface TrackerOptions {
  history: Map<string, TrackedSession>;
  rpc: ReturnType<typeof createCodexRpc>;
  isLive: () => boolean;
  onChange: (snapshot: SessionSnapshot) => void;
  onReport: (report: CodexSessionReport) => void;
  onSubscribed: () => void;
}

export function createCodexSessionHistory() {
  return new Map<string, TrackedSession>();
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function readStatus(value: unknown): { type: 'active' | 'idle' | 'systemError' | 'notLoaded'; flags: string[] } | null {
  const status = rpcRecord(value);
  const type = typeof value === 'string' ? value : status?.type;
  if (type !== 'active' && type !== 'idle' && type !== 'systemError' && type !== 'notLoaded') return null;
  const flags = Array.isArray(status?.activeFlags)
    ? status.activeFlags.filter((flag): flag is string => flag === 'waitingOnApproval' || flag === 'waitingOnUserInput')
    : [];
  return { type, flags };
}

function shouldIgnoreThread(thread: Record<string, unknown>) {
  const source = rpcRecord(thread.source);
  // 与官方 TUI 一致：标题生成和系统辅助线程是隐藏的临时会话。
  const hiddenHelper = thread.ephemeral === true
    && (thread.threadSource === 'thread_title' || thread.threadSource === 'system');
  return thread.canAcceptDirectInput === false || textOrNull(thread.parentThreadId) !== null
    || !!source && ['subAgent', 'sub_agent', 'subagent'].some(key => source[key] !== undefined)
    || hiddenHelper;
}

function failureInfo(error: unknown): { reason: SubscriptionFailureReason; code: number | null } {
  if (!(error instanceof CodexRpcError)) return { reason: 'invalidResponse', code: null };
  return {
    reason: error.kind === 'invalidResponse' ? 'invalidResponse' : error.kind === 'timeout' ? 'timeout'
      : error.threadState === 'closing' ? 'threadClosing'
        : error.threadState === 'unavailable' ? 'threadUnavailable' : 'rejected',
    code: error.code,
  };
}

// 保留 app-server 总连接；空闲退订的记录仍在 history 中，轮询不会把它立即订阅回来。
// 同一账号重连复用活动时间，连接抖动和 Portal 自己的查询都不重置五分钟计时。
export function createCodexSessionTracker(options: TrackerOptions) {
  const { history, rpc, onChange, onReport, onSubscribed } = options;
  const subscribed = new Set<string>();
  // 超时不代表 server 没有完成接入；空闲时同样清理尚未确认的订阅。
  const possibleSubscriptions = new Set<string>();
  const ignored = new Set<string>();
  const operations = new Map<string, Promise<void>>();
  const retries = new Map<string, { at: number; attempts: number; signature: string }>();
  let stopped = false;
  let revision = 0;
  let snapshotReady = false;
  let refreshing: Promise<void> | null = null;
  let discoveryFailed = false;
  let lastSyncedAt: number | null = null;
  let lastReportedCounts = '';
  let publishTimer: ReturnType<typeof setTimeout> | undefined;
  let activityTimer: ReturnType<typeof setTimeout> | undefined;
  for (const session of history.values()) session.revision = 0;

  const live = () => !stopped && options.isLive();
  const eligible = (session: TrackedSession) => !ignored.has(session.id) && session.loaded && session.eligible
    && (session.status === 'active' || Date.now() - session.lastActivityAt < IDLE_TIMEOUT_MS);
  const visible = (session: TrackedSession) => session.verified && eligible(session);

  const publish = (immediate = false) => {
    if (!live()) return;
    if (!immediate) {
      if (!publishTimer) publishTimer = setTimeout(() => { publishTimer = undefined; publish(true); }, 500);
      return;
    }
    clearTimeout(publishTimer);
    publishTimer = undefined;
    const sessions: CodexActiveSession[] = snapshotReady
      ? [...history.values()].filter(visible).map(session => ({
        id: session.id, cwd: session.cwd, name: session.name, status: session.status,
        activeFlags: session.activeFlags, lastActivityAt: session.lastActivityAt,
      })).sort((a, b) => b.lastActivityAt - a.lastActivityAt || a.id.localeCompare(b.id))
      : [];
    onChange({ sessions, activeCount: snapshotReady ? sessions.length : null,
      isRefreshing: refreshing !== null, discoveryFailed, lastSyncedAt });
    if (snapshotReady) {
      const listening = sessions.filter(session => subscribed.has(session.id)).length;
      const counts = `${sessions.length}:${listening}`;
      if (counts !== lastReportedCounts) {
        lastReportedCounts = counts;
        onReport({ kind: 'threadSubscriptions', active: sessions.length, subscribed: listening });
      }
    }
  };

  const remove = (id: string, keepIgnored = false) => {
    history.delete(id);
    subscribed.delete(id);
    possibleSubscriptions.delete(id);
    retries.delete(id);
    if (!keepIgnored) ignored.delete(id);
  };
  const ignore = (id: string) => {
    ignored.add(id);
    const session = history.get(id);
    if (session) {
      // 立即从展示移除；保留订阅记录，让 reconcile 串行完成退订及失败重试。
      session.eligible = false;
      session.verified = false;
    }
  };
  const track = (id: string): TrackedSession => {
    let session = history.get(id);
    if (!session) {
      // 查询完成前的临时时间；初始快照随后以官方更新时间建立活动基线。
      session = { id, cwd: null, name: null, status: 'unknown', activeFlags: [],
        lastActivityAt: Date.now(), loaded: true, eligible: true, verified: false,
        activityObserved: false, updatedAt: null, revision: ++revision };
      history.set(id, session);
    }
    return session;
  };
  const touch = (session: TrackedSession, retryNow = false) => {
    const wasInactive = !session.eligible;
    session.lastActivityAt = Date.now();
    session.eligible = true;
    session.activityObserved = true;
    if (wasInactive || retryNow) retries.delete(session.id);
  };
  const applyStatus = (session: TrackedSession, value: unknown, activity: boolean, completionActivity = true) => {
    const status = readStatus(value);
    if (!status) return;
    if (status.type === 'notLoaded') { remove(session.id); return; }
    const previous = session.status;
    session.status = status.type;
    session.activeFlags = status.flags;
    session.loaded = true;
    if (activity && (status.type === 'active' && (previous !== 'active' || !session.eligible)
      || completionActivity && previous === 'active' && status.type !== 'active')) {
      touch(session, status.type === 'active' && previous !== 'active');
    }
  };
  const applyMetadata = (session: TrackedSession, thread: Record<string, unknown>, activity: boolean, withStatus = true) => {
    if (thread.id !== session.id) throw new CodexRpcError('invalidResponse');
    if (shouldIgnoreThread(thread)) {
      ignore(session.id);
      return;
    }
    session.cwd = textOrNull(thread.cwd);
    session.name = textOrNull(thread.name);
    session.verified = true;
    const updated = typeof thread.updatedAt === 'number' && Number.isFinite(thread.updatedAt) ? thread.updatedAt : null;
    if (!session.activityObserved && session.updatedAt === null && updated !== null && updated > 0) {
      // 已经空闲很久的 loaded 会话不因 Portal 启动而重新获得五分钟活动时间。
      session.lastActivityAt = Math.min(Date.now(), updated * 1000);
      session.eligible = Date.now() - session.lastActivityAt < IDLE_TIMEOUT_MS;
    }
    if (activity && updated !== null && session.updatedAt !== null && updated > session.updatedAt) {
      const wasInactive = !session.eligible;
      // 轮询发现变化时采用官方写入时间，避免较晚的查询延长已经结束的活动。
      session.lastActivityAt = Math.max(session.lastActivityAt, Math.min(Date.now(), updated * 1000));
      session.eligible = readStatus(thread.status)?.type === 'active' || Date.now() - session.lastActivityAt < IDLE_TIMEOUT_MS;
      session.activityObserved = true;
      if (wasInactive && session.eligible) retries.delete(session.id);
    }
    if (updated !== null) session.updatedAt = Math.max(updated, session.updatedAt ?? updated);
    if (withStatus) applyStatus(session, thread.status, activity, updated === null);
  };

  const scheduleActivity = () => {
    clearTimeout(activityTimer);
    if (!live()) return;
    let next = Infinity;
    for (const session of history.values()) {
      if (session.eligible && session.status !== 'active') next = Math.min(next, session.lastActivityAt + IDLE_TIMEOUT_MS);
      const retry = retries.get(session.id);
      if (retry && !operations.has(session.id)) next = Math.min(next, retry.at);
    }
    if (Number.isFinite(next)) activityTimer = setTimeout(() => {
      if (!live()) return;
      for (const session of history.values()) {
        if (session.eligible && session.status !== 'active' && Date.now() - session.lastActivityAt >= IDLE_TIMEOUT_MS) {
          session.eligible = false;
        }
        reconcile(session);
      }
      publish(true);
      scheduleActivity();
    }, Math.max(50, next - Date.now()));
  };

  const reconcile = (session: TrackedSession) => {
    if (!live() || history.get(session.id) !== session || operations.has(session.id)) return;
    const wantsSubscription = eligible(session);
    if (wantsSubscription ? subscribed.has(session.id) : !subscribed.has(session.id) && !possibleSubscriptions.has(session.id)) {
      if (ignored.has(session.id)) remove(session.id, true);
      else retries.delete(session.id);
      return;
    }
    const retry = retries.get(session.id);
    if (retry && retry.at > Date.now()) return;
    const operation = (async () => {
      // 同一会话的 resume/unsubscribe 串行执行；退订期间出现新任务会在响应后立即接回。
      while (live() && history.get(session.id) === session) {
        const wantsSubscription = eligible(session);
        if (wantsSubscription ? subscribed.has(session.id) : !subscribed.has(session.id) && !possibleSubscriptions.has(session.id)) break;
        const before = session.revision;
        try {
          if (wantsSubscription) {
            if (!session.verified) {
              const result = await rpc.request('thread/read', { threadId: session.id, includeTurns: false });
              if (!live() || history.get(session.id) !== session) return;
              const thread = rpcRecord(result.thread);
              if (!thread) throw new CodexRpcError('invalidResponse');
              applyMetadata(session, thread, true, before === session.revision);
              continue;
            }
            possibleSubscriptions.add(session.id);
            const result = await rpc.request('thread/resume', { threadId: session.id, excludeTurns: true });
            if (!live()) return;
            if (history.get(session.id) !== session) {
              // 会话可能在接入请求期间关闭；不留下已从统计移除的 Portal 订阅。
              if (!history.has(session.id) || ignored.has(session.id)) {
                await rpc.request('thread/unsubscribe', { threadId: session.id });
                possibleSubscriptions.delete(session.id);
              } else {
                subscribed.add(session.id);
                onSubscribed();
              }
              return;
            }
            const thread = rpcRecord(result.thread);
            if (!thread) throw new CodexRpcError('invalidResponse');
            // 接入响应及历史回放只更新基线，不算用户活动；较新的状态广播优先。
            applyMetadata(session, thread, false, before === session.revision);
            if (history.get(session.id) !== session) return;
            subscribed.add(session.id);
            if (!ignored.has(session.id)) onSubscribed();
          } else {
            const result = await rpc.request('thread/unsubscribe', { threadId: session.id });
            if (!live() || history.get(session.id) !== session) return;
            if (result.status !== 'unsubscribed' && result.status !== 'notSubscribed' && result.status !== 'notLoaded') {
              throw new CodexRpcError('invalidResponse');
            }
            subscribed.delete(session.id);
            possibleSubscriptions.delete(session.id);
            if (result.status === 'notLoaded') remove(session.id);
            else if (ignored.has(session.id)) remove(session.id, true);
            else onReport({ kind: 'threadIdleReleased', count: 1 });
          }
          retries.delete(session.id);
          publish(true);
        } catch (error) {
          if (!live() || history.get(session.id) !== session) return;
          const info = failureInfo(error);
          const previous = retries.get(session.id);
          const attempts = (previous?.attempts ?? 0) + 1;
          const signature = `${wantsSubscription}:${info.reason}:${info.code}`;
          if (previous?.signature !== signature) {
            onReport({ kind: wantsSubscription ? 'threadSubscriptionFailed' : 'threadUnsubscriptionFailed', count: 1, ...info });
          }
          if (info.reason === 'threadUnavailable') remove(session.id);
          else retries.set(session.id, { at: Date.now() + Math.min(2000 * 2 ** Math.min(attempts - 1, 5), 60000), attempts, signature });
          break;
        }
      }
    })();
    operations.set(session.id, operation);
    void operation.finally(() => {
      operations.delete(session.id);
      if (live()) {
        const current = history.get(session.id);
        if (current) reconcile(current);
        scheduleActivity();
      }
    }).catch(() => {});
  };

  const refresh = (): Promise<void> => {
    if (!live()) return Promise.resolve();
    if (refreshing) return refreshing;
    const startRevision = revision;
    refreshing = (async () => {
      try {
        const ids = new Set<string>();
        const cursors = new Set<string>();
        let cursor: string | null = null;
        do {
          const page = await rpc.request('thread/loaded/list', { limit: 100, ...(cursor ? { cursor } : {}) });
          if (!live()) return;
          if (!Array.isArray(page.data) || page.data.some(id => typeof id !== 'string' || !id)) throw new CodexRpcError('invalidResponse');
          for (const id of page.data as string[]) ids.add(id);
          cursor = textOrNull(page.nextCursor);
          if (cursor && cursors.has(cursor)) throw new CodexRpcError('invalidResponse');
          if (cursor) cursors.add(cursor);
        } while (cursor);
        for (const session of history.values()) {
          // 初始快照之后才出现的广播不能被较旧的查询结果删除。
          if (!ids.has(session.id) && session.revision <= startRevision) remove(session.id);
        }
        for (const id of ignored) if (!ids.has(id)) ignored.delete(id);
        let failedReads = false;
        const queue = [...ids].filter(id => !ignored.has(id));
        let index = 0;
        await Promise.all(Array.from({ length: Math.min(queue.length, 4) }, async () => {
          while (live() && index < queue.length) {
            const id = queue[index++];
            const session = track(id);
            const before = session.revision;
            try {
              const result = await rpc.request('thread/read', { threadId: id, includeTurns: false });
              if (!live()) return;
              if (history.get(id) !== session || session.revision !== before) continue;
              const thread = rpcRecord(result.thread);
              if (!thread) throw new CodexRpcError('invalidResponse');
              applyMetadata(session, thread, true);
            } catch (error) {
              if (!live()) return;
              if (failureInfo(error).reason === 'threadUnavailable') remove(id);
              else failedReads = true;
            }
            reconcile(session);
          }
        }));
        if (!live()) return;
        snapshotReady = true;
        if (failedReads && !discoveryFailed) onReport({ kind: 'threadDiscoveryFailed' });
        discoveryFailed = failedReads;
        lastSyncedAt = Date.now();
      } catch {
        if (live()) {
          if (!discoveryFailed) onReport({ kind: 'threadDiscoveryFailed' });
          discoveryFailed = true;
        }
      } finally {
        refreshing = null;
        if (live()) { publish(true); scheduleActivity(); }
      }
    })();
    publish(true);
    return refreshing;
  };

  const notify = (method: string, params: Record<string, unknown>) => {
    if (!live()) return;
    if (method === 'thread/started') {
      const thread = rpcRecord(params.thread);
      const id = textOrNull(thread?.id);
      if (!id || !thread) return;
      if (shouldIgnoreThread(thread)) {
        ignore(id);
        const session = history.get(id);
        if (session) reconcile(session);
        publish();
        scheduleActivity();
        return;
      }
      const session = track(id);
      session.revision = ++revision;
      touch(session);
      applyMetadata(session, thread, false);
      reconcile(session);
    } else {
      const id = textOrNull(params.threadId);
      if (!id || ignored.has(id)) return;
      if (method === 'thread/closed' || method === 'thread/archived' || method === 'thread/deleted') {
        remove(id);
      } else if (method === 'thread/status/changed') {
        const status = readStatus(params.status);
        if (!status) return;
        if (status.type === 'notLoaded') remove(id);
        else {
          const newlyLoaded = !history.has(id);
          const session = track(id);
          session.revision = ++revision;
          if (newlyLoaded) touch(session);
          applyStatus(session, params.status, true);
          // 此通知是全局广播；空闲已退订的会话进入 active 时仍会走到这里。
          reconcile(session);
        }
      } else {
        const session = history.get(id);
        if (!session) return;
        if (method === 'turn/started' || method === 'turn/completed') {
          session.revision = ++revision;
          touch(session, method === 'turn/started');
          session.status = method === 'turn/started' ? 'active' : 'idle';
          session.activeFlags = [];
        } else if (method === 'item/started' || method === 'item/completed'
          || method.startsWith('item/') && (method.endsWith('Delta') || method.endsWith('/delta'))) {
          session.revision = ++revision;
          touch(session);
        } else if (method === 'thread/name/updated') {
          session.revision = ++revision;
          session.name = textOrNull(params.threadName ?? params.name);
        } else return;
        reconcile(session);
      }
    }
    publish();
    scheduleActivity();
  };

  const pollTimer = setInterval(() => { void refresh(); }, DISCOVERY_INTERVAL_MS);
  return {
    refresh,
    notify,
    stop() {
      stopped = true;
      clearInterval(pollTimer);
      clearTimeout(activityTimer);
      clearTimeout(publishTimer);
    },
  };
}
