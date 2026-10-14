import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getVersion } from '@tauri-apps/api/app';
import type { AccountUsage } from '../types/account';
import type { CodexEventContext, CodexLiveUsage, CodexSessionMonitor } from '../types/codexEvents';
import { CodexRpcError, createCodexRpc, rpcRecord } from '../utils/codexAppServer';
import { createCodexSessionHistory, createCodexSessionTracker, type CodexSessionReport } from '../utils/codexSessionMonitor';

interface QuotaWindow {
  usedPercent: number | null;
  windowDurationMins: number | null;
  resetsAt: number | null;
}
interface QuotaSnapshot { primary: QuotaWindow | null; secondary: QuotaWindow | null }
type ExhaustionReason = 'usageLimitExceeded' | 'windowFull';
type QuotaStatus = 'rate_limit_reached' | 'workspace_owner_credits_depleted' | 'workspace_member_credits_depleted'
  | 'workspace_owner_usage_limit_reached' | 'workspace_member_usage_limit_reached' | 'unknown';
type ListenerReport = CodexSessionReport
  | { kind: 'connected' | 'disconnected' | 'connectionFailed' | 'initializationFailed' | 'initialReadFailed' | 'quotaCacheFailed' }
  | { kind: 'rateLimits'; pushed: boolean; manual: boolean; primary: QuotaWindow | null; secondary: QuotaWindow | null }
  | { kind: 'quotaStatus'; status: QuotaStatus | null; spendControlReached: boolean | null }
  | { kind: 'quotaExhausted'; reason: ExhaustionReason };

function readQuotaStatus(value: unknown): QuotaStatus | null {
  if (typeof value !== 'string' || !value) return null;
  switch (value) {
    case 'rate_limit_reached': case 'workspace_owner_credits_depleted': case 'workspace_member_credits_depleted':
    case 'workspace_owner_usage_limit_reached': case 'workspace_member_usage_limit_reached': return value;
    default: return 'unknown';
  }
}
function emptyMonitor(): CodexSessionMonitor {
  return { connectionStatus: 'connecting', activeCount: null, sessions: [], isRefreshing: false,
    discoveryFailed: false, lastSyncedAt: null, quotaPushCount: 0, lastQuotaPushAt: null };
}
function emptyUsage(accountId: string | null = null): CodexLiveUsage {
  return { accountId, usage: null, source: null, isRefreshing: false, error: null };
}
function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
function integerOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}
function mergeWindow(previous: QuotaWindow | null, value: unknown, fillOnly: boolean): QuotaWindow | null {
  const window = rpcRecord(value);
  if (!window) return previous;
  const next = { usedPercent: numberOrNull(window.usedPercent),
    windowDurationMins: integerOrNull(window.windowDurationMins), resetsAt: integerOrNull(window.resetsAt) };
  // 推送为稀疏更新；迟到的查询只补充缺失字段，不覆盖已收到的推送。
  return {
    usedPercent: fillOnly ? previous?.usedPercent ?? next.usedPercent : next.usedPercent ?? previous?.usedPercent ?? null,
    windowDurationMins: fillOnly ? previous?.windowDurationMins ?? next.windowDurationMins : next.windowDurationMins ?? previous?.windowDurationMins ?? null,
    resetsAt: fillOnly ? previous?.resetsAt ?? next.resetsAt : next.resetsAt ?? previous?.resetsAt ?? null,
  };
}
function toUsageWindow(window: QuotaWindow | null) {
  return window ? { usedPercent: window.usedPercent, windowMinutes: window.windowDurationMins, resetsAt: window.resetsAt } : null;
}

// 实时监听是附加能力；连接不可用时结束，sessions 同步独立维护账号额度。
export function useCodexRateLimitListener() {
  const [monitor, setMonitor] = useState<CodexSessionMonitor>(emptyMonitor);
  const [liveUsage, setLiveUsage] = useState<CodexLiveUsage>(() => emptyUsage());
  const refreshSessionsRef = useRef<(() => Promise<void>) | null>(null);
  const refreshUsageRef = useRef<(() => Promise<void>) | null>(null);
  const refreshSessions = useCallback(() => { void refreshSessionsRef.current?.(); }, []);
  const refreshUsage = useCallback(async () => {
    if (!refreshUsageRef.current) throw new Error('额度查询连接尚未就绪，请稍后重试。');
    await refreshUsageRef.current();
  }, []);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let connecting = false;
    let stopSession: (() => void) | null = null;
    let subscriptionEnded = false;
    let initializedOnce = false;
    let contextConnectionPending = false;
    let failureReported = false;
    let context: CodexEventContext | null = null;
    let contextRequest = 0;
    let contextGeneration = 0;
    let quotaRevision = 0;
    let snapshot: QuotaSnapshot = { primary: null, secondary: null };
    let latestUsage: AccountUsage | null = null;
    let latestSource: CodexLiveUsage['source'] = null;
    let lastQuotaStatus = '';
    const sessionHistory = createCodexSessionHistory();
    const exhaustion = new Set<ExhaustionReason>();
    const unlisteners: Array<() => void> = [];
    let reportQueue = Promise.resolve();
    let cacheQueue = Promise.resolve();
    let cacheFailureReported = false;

    const report = (payload: ListenerReport) => {
      const generation = contextGeneration;
      reportQueue = reportQueue.then(async () => {
        if (!disposed && generation === contextGeneration) await invoke('report_codex_listener_event', { report: payload });
      }).catch(() => {});
    };
    const applyContext = (next: CodexEventContext) => {
      if (disposed || context && (next.epoch < context.epoch
        || next.epoch === context.epoch && !context.switching && next.switching)) return false;
      const changed = !context || context.epoch !== next.epoch || context.accountId !== next.accountId;
      const reconnectForAccount = changed && context !== null && initializedOnce;
      context = next;
      if (changed) {
        contextGeneration += 1;
        quotaRevision = 0;
        snapshot = { primary: null, secondary: null };
        latestUsage = null;
        latestSource = null;
        lastQuotaStatus = '';
        exhaustion.clear();
        sessionHistory.clear();
        cacheFailureReported = false;
        setLiveUsage(emptyUsage(next.accountId));
        if (reconnectForAccount) {
          // 已启用监听的客户端切换账号后建立一次新连接；没有服务时不因账号变化再次探测。
          subscriptionEnded = false;
          contextConnectionPending = true;
        }
        setMonitor({ ...emptyMonitor(), connectionStatus: subscriptionEnded ? 'unavailable' : 'connecting' });
        stopSession?.();
        stopSession = null;
        socket?.close();
        socket = null;
      }
      return true;
    };
    const refreshContext = async () => {
      const request = ++contextRequest;
      try {
        const next = await invoke<CodexEventContext>('get_codex_event_context');
        if (!disposed && request === contextRequest) applyContext(next);
      } catch {
        // 不使用未经确认的账号保存额度；这里只更新上下文，不触发连接重试。
      }
    };
    const reportExhaustion = (reason: ExhaustionReason) => {
      if (!exhaustion.has(reason)) { exhaustion.add(reason); report({ kind: 'quotaExhausted', reason }); }
    };
    const applyLimits = (payload: Record<string, unknown>, source: 'initialRead' | 'push' | 'manualRead', fillOnly = false, observedAt = Date.now()) => {
      if (!context || context.switching || disposed) return;
      const buckets = rpcRecord(payload.rateLimitsByLimitId);
      const limits = rpcRecord(buckets?.codex ?? payload.rateLimits);
      if (!limits || typeof limits.limitId === 'string' && limits.limitId !== 'codex') return;
      snapshot = { primary: mergeWindow(snapshot.primary, limits.primary, fillOnly),
        secondary: mergeWindow(snapshot.secondary, limits.secondary, fillOnly) };
      const pushed = source === 'push';
      const receivedAt = observedAt;
      const accountId = context.accountId;
      const epoch = context.epoch;
      const usage: AccountUsage = { primary: toUsageWindow(snapshot.primary), secondary: toUsageWindow(snapshot.secondary),
        syncedAt: fillOnly && latestUsage ? latestUsage.syncedAt : new Date(receivedAt).toISOString() };
      latestUsage = usage;
      if (!fillOnly || latestSource === null) latestSource = source;
      const displayedSource = latestSource;
      setLiveUsage(previous => ({ ...previous, accountId, usage, source: displayedSource, error: null }));
      if (pushed) {
        quotaRevision += 1;
        setMonitor(previous => ({ ...previous, quotaPushCount: previous.quotaPushCount + 1, lastQuotaPushAt: receivedAt }));
      }
      report({ kind: 'rateLimits', pushed, manual: source === 'manualRead', ...snapshot });
      const status = readQuotaStatus(limits.rateLimitReachedType);
      const spendControlReached = typeof limits.spendControlReached === 'boolean' ? limits.spendControlReached : null;
      if (status !== null || spendControlReached === true) {
        const signature = `${status}:${spendControlReached}`;
        if (signature !== lastQuotaStatus) { lastQuotaStatus = signature; report({ kind: 'quotaStatus', status, spendControlReached }); }
      } else if (!pushed || spendControlReached === false) { lastQuotaStatus = ''; }
      const percentages = [snapshot.primary?.usedPercent, snapshot.secondary?.usedPercent].filter((used): used is number => typeof used === 'number');
      if (percentages.some(used => used >= 100)) reportExhaustion('windowFull');
      else if (percentages.length > 0) exhaustion.clear();
      if (accountId) {
        cacheQueue = cacheQueue.then(async () => {
          if (disposed || context?.epoch !== epoch || context.accountId !== accountId || context.switching) return;
          try {
            await invoke('save_codex_live_usage', { epoch, accountId, usage });
            cacheFailureReported = false;
          } catch {
            if (!cacheFailureReported && context?.epoch === epoch) { cacheFailureReported = true; report({ kind: 'quotaCacheFailed' }); }
          }
        }).catch(() => {});
      }
    };
    const connect = async () => {
      if (disposed || connecting || socket || subscriptionEnded) return;
      connecting = true;
      contextConnectionPending = false;
      let initialized = false;
      let reading: Promise<void> | null = null;
      let tracker: ReturnType<typeof createCodexSessionTracker> | null = null;
      let connectionTimer: ReturnType<typeof setTimeout> | undefined;
      let quotaCatchupTimer: ReturnType<typeof setTimeout> | undefined;
      const fail = (kind: 'connectionFailed' | 'initializationFailed') => {
        if (!failureReported) { failureReported = true; report({ kind }); }
      };
      try {
        const request = ++contextRequest;
        const [url, version, next] = await Promise.all([
          invoke<string>('get_codex_event_url'), getVersion(), invoke<CodexEventContext>('get_codex_event_context'),
        ]);
        if (disposed) return;
        if (request !== contextRequest) { contextConnectionPending = true; return; }
        applyContext(next);
        if (!context || context.switching) { contextConnectionPending = true; return; }
        contextConnectionPending = false;
        const generation = contextGeneration;
        const current = new WebSocket(url);
        socket = current;
        const rpc = createCodexRpc(current);
        const live = () => !disposed && socket === current && generation === contextGeneration
          && !context?.switching && current.readyState === WebSocket.OPEN;
        const readLimits = (manual = false): Promise<void> => {
          if (!live()) return manual ? Promise.reject(new Error('额度查询连接尚未就绪，请稍后重试。')) : Promise.resolve();
          if (reading) return reading;
          const revision = quotaRevision;
          // 主动读取以请求发起时间为观测基线，迟到响应不能覆盖请求期间同步的新额度。
          const observedAt = Date.now();
          setLiveUsage(previous => ({ ...previous, isRefreshing: true, error: null }));
          reading = (async () => {
            try {
              const result = await rpc.request('account/rateLimits/read');
              if (live()) applyLimits(result, manual ? 'manualRead' : 'initialRead', revision !== quotaRevision, observedAt);
            } catch {
              if (live()) {
                setLiveUsage(previous => ({ ...previous, error: '额度查询失败；收到会话推送后仍会自动更新。' }));
                report({ kind: 'initialReadFailed' });
              }
              if (manual) throw new Error('额度查询失败，请稍后重试。');
            } finally {
              reading = null;
              if (live()) setLiveUsage(previous => ({ ...previous, isRefreshing: false }));
            }
          })();
          return reading;
        };
        const catchUpQuota = () => {
          // 恢复订阅时补读一次，补齐接入之前可能错过的首条推送；不定时轮询额度。
          if (!quotaCatchupTimer) quotaCatchupTimer = setTimeout(() => {
            quotaCatchupTimer = undefined;
            if (live()) void readLimits();
          }, 200);
        };
        stopSession = () => {
          clearTimeout(connectionTimer);
          clearTimeout(quotaCatchupTimer);
          tracker?.stop();
          refreshSessionsRef.current = null;
          refreshUsageRef.current = null;
          rpc.close();
        };
        // 为两路引擎探测、连接回退和 RPC 初始化预留时间。
        connectionTimer = setTimeout(() => {
          if (!disposed && socket === current && !initialized) { fail('initializationFailed'); current.close(); }
        }, 45000);
        current.onopen = () => {
          void (async () => {
            try {
              const clientInfo = { name: 'codex_portal_events', title: 'Codex Portal quota listener', version };
              try {
                // excludeTurns 是受实验能力约束的字段；CLI 与桌面连接统一声明。
                await rpc.request('initialize', { clientInfo, capabilities: { experimentalApi: true } }, 15000);
              } catch (error) {
                if (!live() || !(error instanceof CodexRpcError)
                  || error.kind !== 'response' || error.code !== -32602) throw error;
                // 老版本拒绝能力参数时，使用基础初始化；订阅参数按响应再降级。
                await rpc.request('initialize', { clientInfo }, 15000);
              }
              if (!live()) return;
              if (!rpc.notify('initialized')) throw new CodexRpcError('closed');
              initialized = true;
              clearTimeout(connectionTimer);
              initializedOnce = true;
              failureReported = false;
              tracker = createCodexSessionTracker({ history: sessionHistory, rpc, isLive: live,
                onChange: nextSnapshot => setMonitor(previous => ({ ...previous, ...nextSnapshot })),
                onReport: report, onSubscribed: catchUpQuota });
              setMonitor(previous => ({ ...previous, connectionStatus: 'connected' }));
              refreshSessionsRef.current = tracker.refresh;
              refreshUsageRef.current = () => readLimits(true);
              report({ kind: 'connected' });
              void tracker.refresh();
              void readLimits();
            } catch {
              if (live()) { fail('initializationFailed'); current.close(); }
            }
          })();
        };
        current.onmessage = event => {
          if (disposed || socket !== current || generation !== contextGeneration || context?.switching || typeof event.data !== 'string') return;
          let message: Record<string, unknown> | null;
          try { message = rpcRecord(JSON.parse(event.data)); } catch { return; }
          if (!message || rpc.acceptResponse(message) || !initialized || message.id !== undefined) return;
          const params = rpcRecord(message.params) ?? {};
          if (message.method === 'account/rateLimits/updated') applyLimits(params, 'push');
          else if (message.method === 'account/updated') void readLimits();
          else if (typeof message.method === 'string') {
            tracker?.notify(message.method, params);
            if (message.method === 'error') {
              const error = rpcRecord(params.error);
              const info = error?.codexErrorInfo;
              if (info === 'usageLimitExceeded' || rpcRecord(info)?.usageLimitExceeded !== undefined) reportExhaustion('usageLimitExceeded');
            }
          }
        };
        current.onerror = () => { if (!disposed && socket === current) fail('connectionFailed'); };
        current.onclose = () => {
          if (disposed || socket !== current) return;
          stopSession?.();
          stopSession = null;
          socket = null;
          subscriptionEnded = true;
          contextConnectionPending = false;
          setMonitor(previous => ({ ...previous, connectionStatus: 'unavailable', activeCount: null, sessions: [], isRefreshing: false }));
          setLiveUsage(previous => ({ ...previous, isRefreshing: false }));
          if (initialized) report({ kind: 'disconnected' }); else fail('connectionFailed');
        };
      } catch {
        if (!disposed) {
          subscriptionEnded = true;
          contextConnectionPending = false;
          fail('connectionFailed');
          setMonitor(previous => ({ ...previous, connectionStatus: 'unavailable' }));
        }
      } finally {
        connecting = false;
        if (!disposed && contextConnectionPending && !subscriptionEnded && !context?.switching) void connect();
      }
    };
    const syncContextAndSessions = async () => {
      await refreshContext();
      if (disposed) return;
      if (socket && !context?.switching) void refreshSessionsRef.current?.();
    };
    const boot = async () => {
      const results = await Promise.allSettled([
        listen<CodexEventContext>('codex-account-context', event => {
          contextRequest += 1;
          if (applyContext(event.payload) && !event.payload.switching && contextConnectionPending) void connect();
        }),
        listen('accounts-updated', () => { void syncContextAndSessions(); }),
      ]);
      if (disposed || results.some(result => result.status === 'rejected')) {
        for (const result of results) if (result.status === 'fulfilled') result.value();
        if (!disposed) {
          subscriptionEnded = true;
          setMonitor(previous => ({ ...previous, connectionStatus: 'unavailable' }));
          report({ kind: 'connectionFailed' });
        }
        return;
      }
      for (const result of results) if (result.status === 'fulfilled') unlisteners.push(result.value);
      if (!disposed) void connect();
    };
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') void syncContextAndSessions(); };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    void boot();
    return () => {
      disposed = true;
      stopSession?.();
      socket?.close();
      refreshSessionsRef.current = null;
      refreshUsageRef.current = null;
      unlisteners.forEach(unlisten => unlisten());
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, []);

  return { monitor, liveUsage, refreshSessions, refreshUsage };
}
