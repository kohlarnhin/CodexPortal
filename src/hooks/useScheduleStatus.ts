import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ScheduleStatus } from '../types/account';

export function useScheduleStatus() {
  const [status, setStatus] = useState<ScheduleStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let disposed = false;
    let revision = 0;
    const unlisteners: Array<() => void> = [];
    const refresh = async () => {
      const request = ++revision;
      try {
        const next = await invoke<ScheduleStatus>('get_schedule_status');
        if (!disposed && request === revision) {
          setStatus(next);
          setUnavailable(false);
        }
      } catch {
        if (!disposed && request === revision) setUnavailable(true);
      }
    };

    void refresh();
    void Promise.allSettled([
      listen('accounts-updated', () => { void refresh(); }),
      listen('usage-updated', () => { void refresh(); }),
    ]).then((results) => {
      for (const result of results) {
        if (result.status === 'fulfilled') {
          if (disposed) result.value();
          else unlisteners.push(result.value);
        }
      }
      // 补读注册监听期间发生的变更。
      if (!disposed) void refresh();
    });
    const timer = window.setInterval(() => { void refresh(); }, 60_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  return { status, unavailable };
}
