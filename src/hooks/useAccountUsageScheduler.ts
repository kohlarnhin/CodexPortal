import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { AccountUsage } from '../types/account';

/**
 * 账号额度刷新调度。
 *
 * 自动刷新已由后端后台调度器驱动（启动全量逐个刷新 + 按 next_refresh_at 精确触发），
 * 前端仅监听事件刷新 UI；手动刷新仍直接调用后端命令。
 */
export function useAccountUsageScheduler() {
  const [usageRevision, setUsageRevision] = useState(0);
  const [refreshingAccountIds, setRefreshingAccountIds] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];

    const handleUsageUpdated = () => {
      if (disposed) return;
      setUsageRevision((revision) => revision + 1);
    };
    const handleRefreshStarted = (event: { payload: { accountId: string } }) => {
      if (disposed) return;
      const { accountId } = event.payload;
      setRefreshingAccountIds((current) => new Set(current).add(accountId));
    };
    const handleRefreshFinished = (event: { payload: { accountId: string } }) => {
      if (disposed) return;
      const { accountId } = event.payload;
      setRefreshingAccountIds((current) => {
        const next = new Set(current);
        next.delete(accountId);
        return next;
      });
    };

    void Promise.all([
      listen('usage-updated', handleUsageUpdated),
      listen<{ accountId: string }>('usage-refresh-started', handleRefreshStarted),
      listen<{ accountId: string }>('usage-refresh-finished', handleRefreshFinished),
    ]).then((resolved) => {
      if (disposed) {
        resolved.forEach((unlisten) => unlisten());
        return;
      }
      unlisteners.push(...resolved);
    });

    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  const refreshAccountUsage = useCallback(async (accountId: string) => {
    setRefreshingAccountIds((current) => new Set(current).add(accountId));
    try {
      return await invoke<AccountUsage>('refresh_account_usage', { id: accountId });
    } finally {
      setRefreshingAccountIds((current) => {
        const next = new Set(current);
        next.delete(accountId);
        return next;
      });
    }
  }, []);

  const isUsageRefreshing = useCallback(
    (accountId: string) => refreshingAccountIds.has(accountId),
    [refreshingAccountIds],
  );

  return {
    usageRevision,
    refreshAccountUsage,
    isUsageRefreshing,
  };
}
