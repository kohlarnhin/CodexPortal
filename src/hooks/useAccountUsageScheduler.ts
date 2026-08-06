import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AccountUsage, UsageRefreshSummary } from '../types/account';

const USAGE_REFRESH_INTERVAL_MS = 60 * 60 * 1_000;

export function useAccountUsageScheduler() {
  const [usageRevision, setUsageRevision] = useState(0);
  const [timerVersion, setTimerVersion] = useState(0);
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(false);
  const [refreshingAccountIds, setRefreshingAccountIds] = useState<Set<string>>(
    () => new Set(),
  );
  const initialRefreshRequested = useRef(false);
  const autoRefreshInFlight = useRef(false);

  const refreshStaleUsages = useCallback(async () => {
    if (autoRefreshInFlight.current) return;

    autoRefreshInFlight.current = true;
    setIsAutoRefreshing(true);
    try {
      const summary = await invoke<UsageRefreshSummary>('refresh_stale_account_usages');
      if (summary.refreshedAccountIds.length > 0) {
        setUsageRevision((revision) => revision + 1);
      }
    } catch (error) {
      console.warn('Automatic account usage refresh failed', error);
    } finally {
      autoRefreshInFlight.current = false;
      setIsAutoRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (initialRefreshRequested.current) return;
    initialRefreshRequested.current = true;
    void refreshStaleUsages();
  }, [refreshStaleUsages]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshStaleUsages().finally(() => {
        setTimerVersion((version) => version + 1);
      });
    }, USAGE_REFRESH_INTERVAL_MS);

    return () => window.clearTimeout(timer);
  }, [refreshStaleUsages, timerVersion]);

  const refreshAccountUsage = useCallback(async (accountId: string) => {
    setTimerVersion((version) => version + 1);
    setRefreshingAccountIds((current) => {
      const next = new Set(current);
      next.add(accountId);
      return next;
    });

    try {
      const usage = await invoke<AccountUsage>('refresh_account_usage', { id: accountId });
      setUsageRevision((revision) => revision + 1);
      return usage;
    } finally {
      setRefreshingAccountIds((current) => {
        const next = new Set(current);
        next.delete(accountId);
        return next;
      });
    }
  }, []);

  const isUsageRefreshing = useCallback(
    (accountId: string) => isAutoRefreshing || refreshingAccountIds.has(accountId),
    [isAutoRefreshing, refreshingAccountIds],
  );

  return {
    usageRevision,
    refreshAccountUsage,
    isUsageRefreshing,
  };
}
