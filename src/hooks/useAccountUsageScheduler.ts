import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { AccountUsage } from '../types/account';
import { getDisplayedEmail } from '../utils/accountEmail';

/**
 * 账号额度刷新调度。
 *
 * 后端每 5 分钟同步会话，并保存会话返回的账号额度。
 * 同步完成后重新读取本地账号缓存；启动补刷、重置到期和手动刷新使用额度接口。
 */
export function useAccountUsageScheduler(isEmailMaskingEnabled: boolean) {
  const emailMasking = useRef(isEmailMaskingEnabled);
  emailMasking.current = isEmailMaskingEnabled;
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

    void Promise.allSettled([
      listen<{ accountName: string; message: string }>('account-request-failed', (event) => {
        if (!disposed) window.alert(`${getDisplayedEmail(event.payload.accountName, emailMasking.current)}\n${event.payload.message}`);
      }),
      listen('usage-updated', handleUsageUpdated),
      listen('accounts-updated', handleUsageUpdated),
      listen('session-sync-completed', handleUsageUpdated),
      listen<{ accountId: string }>('usage-refresh-started', handleRefreshStarted),
      listen<{ accountId: string }>('usage-refresh-finished', handleRefreshFinished),
    ]).then((resolved) => {
      for (const result of resolved) {
        if (result.status === 'fulfilled') {
          if (disposed) result.value();
          else unlisteners.push(result.value);
        } else {
          console.error('Failed to listen for account usage updates:', result.reason);
        }
      }
      // 补读监听注册期间已同步的额度，避免首次加载与后台同步交错时漏掉更新。
      handleUsageUpdated();
    });

    // 应用从后台恢复时补读本地缓存，不额外请求额度接口。
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') handleUsageUpdated();
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
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
