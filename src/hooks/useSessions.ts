import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  SessionProject,
  SessionRecord,
  SessionSyncResult,
  SessionSyncStatus,
} from '../types/session';

interface SyncProgress {
  done: number;
  total: number;
}

const MIN_MANUAL_SYNC_FEEDBACK_MS = 600;

export function useSessions(onReset?: () => void, includeSubagents: boolean = false) {
  const [projects, setProjects] = useState<SessionProject[]>([]);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [syncResult, setSyncResult] = useState<SessionSyncResult | null>(null);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [status, setStatus] = useState<SessionSyncStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 避免事件回调里用到过期的闭包状态（如当前正在查看的项目）。
  const activeProjectPathRef = useRef<string | null>(null);
  const includeSubagentsRef = useRef(includeSubagents);
  const previousIncludeSubagentsRef = useRef(includeSubagents);
  includeSubagentsRef.current = includeSubagents;
  const syncStateRevisionRef = useRef(0);
  const manualSyncPendingRef = useRef(false);
  const projectsRequestRef = useRef(0);
  const statusRequestRef = useRef(0);
  const sessionsRequestRef = useRef(0);
  const lastCompletedSyncRef = useRef<string | null>(null);
  const syncFeedbackUntilRef = useRef(0);
  const syncFeedbackTimerRef = useRef<number | null>(null);
  const isMountedRef = useRef(false);

  const cancelSyncFeedbackTimer = useCallback(() => {
    if (syncFeedbackTimerRef.current !== null) {
      window.clearTimeout(syncFeedbackTimerRef.current);
      syncFeedbackTimerRef.current = null;
    }
  }, []);

  const finishSyncFeedback = useCallback((immediate: boolean = false) => {
    cancelSyncFeedbackTimer();
    if (!isMountedRef.current) return;
    const finish = () => {
      syncFeedbackTimerRef.current = null;
      syncFeedbackUntilRef.current = 0;
      setIsSyncing(false);
      setIsResetting(false);
      setSyncProgress(null);
    };
    const remaining = immediate ? 0 : syncFeedbackUntilRef.current - performance.now();
    if (remaining > 0) syncFeedbackTimerRef.current = window.setTimeout(finish, remaining);
    else finish();
  }, [cancelSyncFeedbackTimer]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      cancelSyncFeedbackTimer();
    };
  }, [cancelSyncFeedbackTimer]);

  const loadProjects = useCallback(async (showLoading: boolean = true) => {
    const request = ++projectsRequestRef.current;
    const includeSubagents = includeSubagentsRef.current;
    const isCurrent = () => request === projectsRequestRef.current
      && includeSubagents === includeSubagentsRef.current;
    try {
      if (showLoading) setIsLoading(true);
      setError(null);
      const data = await invoke<SessionProject[]>('list_session_projects', { includeSubagents });
      if (isCurrent()) setProjects(data);
    } catch (err: any) {
      console.error('Failed to load session projects:', err);
      if (isCurrent()) {
        setError(err?.toString() || 'Failed to load session projects');
      }
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    const request = ++statusRequestRef.current;
    const revision = syncStateRevisionRef.current;
    const includeSubagents = includeSubagentsRef.current;
    try {
      const data = await invoke<SessionSyncStatus>('get_session_sync_status', { includeSubagents });
      if (request !== statusRequestRef.current
        || revision !== syncStateRevisionRef.current
        || includeSubagents !== includeSubagentsRef.current) return;
      setStatus(data);
      if (!manualSyncPendingRef.current) {
        if (data.isSyncing) {
          cancelSyncFeedbackTimer();
          setIsSyncing(true);
        } else {
          finishSyncFeedback();
        }
      }
    } catch (err: any) {
      console.error('Failed to load session sync status:', err);
    }
  }, [cancelSyncFeedbackTimer, finishSyncFeedback]);

  const loadProjectSessions = useCallback(async (projectPath: string, showLoading: boolean = true) => {
    const request = ++sessionsRequestRef.current;
    const includeSubagents = includeSubagentsRef.current;
    const isCurrent = () => request === sessionsRequestRef.current
      && activeProjectPathRef.current === projectPath
      && includeSubagents === includeSubagentsRef.current;
    try {
      if (showLoading) setIsLoadingSessions(true);
      setError(null);
      const data = await invoke<SessionRecord[]>('list_project_sessions', { projectPath, includeSubagents });
      if (isCurrent()) setSessions(data);
    } catch (err: any) {
      console.error('Failed to load project sessions:', err);
      if (isCurrent()) setError(err?.toString() || 'Failed to load project sessions');
    } finally {
      if (request === sessionsRequestRef.current
        && includeSubagents === includeSubagentsRef.current) setIsLoadingSessions(false);
    }
  }, []);

  const loadSessionContent = useCallback(async (id: string): Promise<string> => {
    return await invoke<string>('get_session_content', { id });
  }, []);

  const applyReset = useCallback(() => {
    // 清空提交后再刷新界面，同时作废清空前发出的列表/状态请求。
    cancelSyncFeedbackTimer();
    syncStateRevisionRef.current += 1;
    projectsRequestRef.current += 1;
    sessionsRequestRef.current += 1;
    activeProjectPathRef.current = null;
    lastCompletedSyncRef.current = null;
    setProjects([]);
    setSessions([]);
    setIsLoading(false);
    setIsLoadingSessions(false);
    setIsSyncing(true);
    setIsResetting(true);
    setSyncResult(null);
    setSyncProgress(null);
    setError(null);
    setStatus({
      isSyncing: true,
      lastSyncedAt: null,
      nextSyncAt: null,
      totalProjects: 0,
      totalSessions: 0,
    });
    onReset?.();
  }, [onReset, cancelSyncFeedbackTimer]);

  const applySyncResult = useCallback(async (result: SessionSyncResult) => {
    // 手动命令和完成事件会返回同一结果，只刷新一次列表。
    if (lastCompletedSyncRef.current === result.syncedAt) return;
    lastCompletedSyncRef.current = result.syncedAt;
    syncStateRevisionRef.current += 1;
    setSyncResult(result);
    setSyncProgress({ done: result.total, total: result.total });
    finishSyncFeedback();
    const activePath = activeProjectPathRef.current;
    await Promise.all([
      loadProjects(false),
      loadStatus(),
      ...(activePath ? [loadProjectSessions(activePath, false)] : []),
    ]);
    if (result.failed > 0) {
      setError(current => current ?? `有 ${result.failed} 个会话文件同步失败，请点击“立即同步”重试。`);
    }
  }, [loadProjects, loadStatus, loadProjectSessions, finishSyncFeedback]);

  const runSync = useCallback(async (reset: boolean) => {
    if (isSyncing || manualSyncPendingRef.current || syncFeedbackTimerRef.current !== null) return;
    manualSyncPendingRef.current = true;
    syncStateRevisionRef.current += 1;
    // 只延长手动操作的视觉反馈，后台同步和列表刷新不等待计时器。
    syncFeedbackUntilRef.current = performance.now() + MIN_MANUAL_SYNC_FEEDBACK_MS;
    try {
      setIsSyncing(true);
      setIsResetting(reset);
      setSyncResult(null);
      setSyncProgress(null);
      setError(null);
      const result = await invoke<SessionSyncResult>(reset ? 'reset_sessions' : 'sync_sessions');
      await applySyncResult(result);
      if (reset && result.failed > 0) {
        setError(`重置已完成，但有 ${result.failed} 个会话文件同步失败，请点击“立即同步”重试。`);
      }
    } catch (err: any) {
      console.error('Failed to sync sessions:', err);
      finishSyncFeedback(true);
      if (reset) await loadProjects(false);
      setError(err?.toString() || (reset ? '重置会话失败' : 'Failed to sync sessions'));
    } finally {
      manualSyncPendingRef.current = false;
      finishSyncFeedback();
      void loadStatus();
    }
  }, [isSyncing, applySyncResult, loadStatus, loadProjects, finishSyncFeedback]);

  const manualSync = useCallback(() => runSync(false), [runSync]);
  const resetAndSync = useCallback(() => runSync(true), [runSync]);

  // 首次加载 + 监听后端同步事件（启动时自动同步 / 每 5 分钟自动同步）。
  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    const register = (subscription: Promise<() => void>) => subscription.then(stop => {
      if (disposed) stop();
      else unlisteners.push(stop);
    });

    const subscriptions = [
      register(listen('sessions-reset', () => {
        if (!disposed) applyReset();
      })),
      register(listen<SyncProgress>('session-sync-progress', event => {
        if (disposed) return;
        cancelSyncFeedbackTimer();
        syncStateRevisionRef.current += 1;
        setIsSyncing(true);
        setSyncProgress(event.payload);
      })),
      register(listen<SessionSyncResult>('session-sync-completed', event => {
        if (disposed) return;
        void applySyncResult(event.payload);
      })),
      register(listen<string>('session-sync-failed', event => {
        if (disposed) return;
        syncStateRevisionRef.current += 1;
        finishSyncFeedback(true);
        setSyncResult(null);
        setError(event.payload);
        void loadStatus();
      })),
    ];
    void loadProjects();
    // 先监听事件再读取状态，切回页面时也能恢复正在进行的后台同步。
    void Promise.all(subscriptions)
      .catch(err => console.error('Failed to listen for session sync:', err))
      .then(() => { if (!disposed) void loadStatus(); });

    return () => {
      disposed = true;
      unlisteners.forEach(stop => stop());
    };
  }, [loadProjects, loadStatus, applyReset, applySyncResult, cancelSyncFeedbackTimer, finishSyncFeedback]);

  // 切换显示范围时刷新列表，后台同步事件保持同一组订阅。
  useEffect(() => {
    if (previousIncludeSubagentsRef.current === includeSubagents) return;
    previousIncludeSubagentsRef.current = includeSubagents;
    setProjects([]);
    setSessions([]);
    setStatus(null);
    void loadProjects();
    void loadStatus();
    const activePath = activeProjectPathRef.current;
    if (activePath) void loadProjectSessions(activePath);
  }, [includeSubagents, loadProjects, loadStatus, loadProjectSessions]);

  return {
    projects,
    sessions,
    isLoading,
    isLoadingSessions,
    isSyncing,
    isResetting,
    syncResult,
    syncProgress,
    status,
    error,
    activeProjectPathRef,
    refresh: loadProjects,
    loadStatus,
    loadProjectSessions,
    loadSessionContent,
    manualSync,
    resetAndSync,
  };
}
