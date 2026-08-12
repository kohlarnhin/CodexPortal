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

  const loadProjects = useCallback(async (showLoading: boolean = true) => {
    try {
      if (showLoading) setIsLoading(true);
      setError(null);
      const data = await invoke<SessionProject[]>('list_session_projects');
      setProjects(data);
    } catch (err: any) {
      console.error('Failed to load session projects:', err);
      setError(err?.toString() || 'Failed to load session projects');
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const data = await invoke<SessionSyncStatus>('get_session_sync_status');
      setStatus(data);
    } catch (err: any) {
      console.error('Failed to load session sync status:', err);
    }
  }, []);

  const loadProjectSessions = useCallback(async (projectPath: string, showLoading: boolean = true) => {
    try {
      if (showLoading) setIsLoadingSessions(true);
      setError(null);
      const data = await invoke<SessionRecord[]>('list_project_sessions', { projectPath });
      setSessions(data);
    } catch (err: any) {
      console.error('Failed to load project sessions:', err);
      setError(err?.toString() || 'Failed to load project sessions');
    } finally {
      if (showLoading) setIsLoadingSessions(false);
    }
  }, []);

  const loadSessionContent = useCallback(async (id: string): Promise<string> => {
    return await invoke<string>('get_session_content', { id });
  }, []);

  const manualSync = useCallback(async () => {
    if (isSyncing) return;
    try {
      setIsSyncing(true);
      setSyncProgress(null);
      setError(null);
      const result = await invoke<SessionSyncResult>('sync_sessions');
      setSyncResult(result);
      await Promise.all([loadProjects(false), loadStatus()]);
      const activePath = activeProjectPathRef.current;
      if (activePath) {
        await loadProjectSessions(activePath, false);
      }
    } catch (err: any) {
      console.error('Failed to sync sessions:', err);
      setError(err?.toString() || 'Failed to sync sessions');
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, loadProjects, loadStatus, loadProjectSessions]);

  // 首次加载 + 监听后端同步事件（启动时自动同步 / 每 5 分钟自动同步）。
  useEffect(() => {
    void loadProjects();
    void loadStatus();

    let unlistenProgress: (() => void) | undefined;
    let unlistenCompleted: (() => void) | undefined;

    (async () => {
      unlistenProgress = await listen<SyncProgress>('session-sync-progress', event => {
        setSyncProgress(event.payload);
      });
      unlistenCompleted = await listen<SessionSyncResult>('session-sync-completed', event => {
        setSyncResult(event.payload);
        setSyncProgress(null);
        void loadProjects(false);
        void loadStatus();
        const activePath = activeProjectPathRef.current;
        if (activePath) {
          void loadProjectSessions(activePath, false);
        }
      });
    })();

    return () => {
      unlistenProgress?.();
      unlistenCompleted?.();
    };
  }, [loadProjects, loadStatus, loadProjectSessions]);

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
