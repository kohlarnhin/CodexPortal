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

export function useSessions() {
  const [projects, setProjects] = useState<SessionProject[]>([]);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SessionSyncResult | null>(null);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [status, setStatus] = useState<SessionSyncStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 避免事件回调里用到过期的闭包状态（如当前正在查看的项目）。
  const activeProjectPathRef = useRef<string | null>(null);
  const syncStateRevisionRef = useRef(0);
  const manualSyncPendingRef = useRef(false);
  const projectsRequestRef = useRef(0);
  const sessionsRequestRef = useRef(0);
  const lastCompletedSyncRef = useRef<string | null>(null);

  const loadProjects = useCallback(async (showLoading: boolean = true) => {
    const request = ++projectsRequestRef.current;
    try {
      if (showLoading) setIsLoading(true);
      setError(null);
      const data = await invoke<SessionProject[]>('list_session_projects');
      if (request === projectsRequestRef.current) setProjects(data);
    } catch (err: any) {
      console.error('Failed to load session projects:', err);
      if (request === projectsRequestRef.current) {
        setError(err?.toString() || 'Failed to load session projects');
      }
    } finally {
      if (request === projectsRequestRef.current) setIsLoading(false);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    const revision = syncStateRevisionRef.current;
    try {
      const data = await invoke<SessionSyncStatus>('get_session_sync_status');
      setStatus(data);
      if (revision === syncStateRevisionRef.current && !manualSyncPendingRef.current) {
        setIsSyncing(data.isSyncing);
        if (!data.isSyncing) setSyncProgress(null);
      }
    } catch (err: any) {
      console.error('Failed to load session sync status:', err);
    }
  }, []);

  const loadProjectSessions = useCallback(async (projectPath: string, showLoading: boolean = true) => {
    const request = ++sessionsRequestRef.current;
    const isCurrent = () => request === sessionsRequestRef.current
      && activeProjectPathRef.current === projectPath;
    try {
      if (showLoading) setIsLoadingSessions(true);
      setError(null);
      const data = await invoke<SessionRecord[]>('list_project_sessions', { projectPath });
      if (isCurrent()) setSessions(data);
    } catch (err: any) {
      console.error('Failed to load project sessions:', err);
      if (isCurrent()) setError(err?.toString() || 'Failed to load project sessions');
    } finally {
      if (request === sessionsRequestRef.current) setIsLoadingSessions(false);
    }
  }, []);

  const loadSessionContent = useCallback(async (id: string): Promise<string> => {
    return await invoke<string>('get_session_content', { id });
  }, []);

  const applySyncResult = useCallback(async (result: SessionSyncResult) => {
    // 手动命令和完成事件会返回同一结果，只刷新一次列表。
    if (lastCompletedSyncRef.current === result.syncedAt) return;
    lastCompletedSyncRef.current = result.syncedAt;
    syncStateRevisionRef.current += 1;
    setIsSyncing(false);
    setSyncResult(result);
    setSyncProgress(null);
    const activePath = activeProjectPathRef.current;
    await Promise.all([
      loadProjects(false),
      loadStatus(),
      ...(activePath ? [loadProjectSessions(activePath, false)] : []),
    ]);
  }, [loadProjects, loadStatus, loadProjectSessions]);

  const manualSync = useCallback(async () => {
    if (isSyncing || manualSyncPendingRef.current) return;
    manualSyncPendingRef.current = true;
    syncStateRevisionRef.current += 1;
    try {
      setIsSyncing(true);
      setSyncProgress(null);
      setError(null);
      const result = await invoke<SessionSyncResult>('sync_sessions');
      await applySyncResult(result);
    } catch (err: any) {
      console.error('Failed to sync sessions:', err);
      setError(err?.toString() || 'Failed to sync sessions');
    } finally {
      manualSyncPendingRef.current = false;
      setIsSyncing(false);
      setSyncProgress(null);
      void loadStatus();
    }
  }, [isSyncing, applySyncResult, loadStatus]);

  // 首次加载 + 监听后端同步事件（启动时自动同步 / 每 5 分钟自动同步）。
  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    const register = (subscription: Promise<() => void>) => subscription.then(stop => {
      if (disposed) stop();
      else unlisteners.push(stop);
    });

    const subscriptions = [
      register(listen<SyncProgress>('session-sync-progress', event => {
        if (disposed) return;
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
        setIsSyncing(false);
        setSyncProgress(null);
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
  }, [loadProjects, loadStatus, applySyncResult]);

  return {
    projects,
    sessions,
    isLoading,
    isLoadingSessions,
    isSyncing,
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
  };
}
