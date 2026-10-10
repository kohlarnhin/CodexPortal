import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { LOG_DISPLAY_LIMIT, type LogEntry, type LogSnapshot, type LogUpdate } from '../types/log';

function mergeEntries(current: LogEntry[], incoming: LogEntry[]): LogEntry[] {
  const entries = new Map<number, LogEntry>();
  for (const entry of current) entries.set(entry.sequence, entry);
  for (const entry of incoming) entries.set(entry.sequence, entry);
  return [...entries.values()]
    .sort((a, b) => a.sequence - b.sequence)
    .slice(-LOG_DISPLAY_LIMIT);
}

export function useLogs() {
  const [snapshot, setSnapshot] = useState<LogSnapshot>({ entries: [], filePath: null, fileError: null });
  const [isLoading, setIsLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    let latestUpdate: LogUpdate | null = null;
    setIsLoading(true);
    setIsLive(false);
    setError(null);

    const connect = async () => {
      try {
        // 先订阅再获取快照，避免加载期间的新日志遗漏；按序号合并去重。
        unlisten = await listen<LogUpdate>('app-log-entry', ({ payload }) => {
          if (disposed) return;
          if (!latestUpdate || payload.entry.sequence > latestUpdate.entry.sequence) {
            latestUpdate = payload;
          }
          setSnapshot(current => ({
            ...current,
            entries: mergeEntries(current.entries, [payload.entry]),
            fileError: payload.entry.sequence >= (current.entries[current.entries.length - 1]?.sequence ?? 0)
              ? payload.fileError
              : current.fileError,
          }));
        });
        if (disposed) {
          unlisten();
          return;
        }
        const initial = await invoke<LogSnapshot>('get_recent_logs');
        if (disposed) return;
        setSnapshot(current => {
          const newestInitial = initial.entries[initial.entries.length - 1]?.sequence ?? 0;
          return {
            ...initial,
            entries: mergeEntries(initial.entries, current.entries),
            fileError: latestUpdate && latestUpdate.entry.sequence > newestInitial
              ? latestUpdate.fileError
              : initial.fileError,
          };
        });
        setIsLive(true);
      } catch (err) {
        unlisten?.();
        unlisten = undefined;
        if (!disposed) {
          setError(`连接日志失败：${String(err)}`);
          setIsLive(false);
        }
      } finally {
        if (!disposed) setIsLoading(false);
      }
    };

    void connect();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [revision]);

  const reconnect = useCallback(() => setRevision(current => current + 1), []);
  return { ...snapshot, isLoading, isLive, error, reconnect };
}
