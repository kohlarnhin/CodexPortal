import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export function useAutoSwitchSettings() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const saving = useRef(false);
  const requestRevision = useRef(0);

  const reload = useCallback(async () => {
    if (saving.current) return;
    const revision = ++requestRevision.current;
    setIsLoading(true);
    setError(null);
    try {
      const value = await invoke<boolean>('get_auto_switch_enabled');
      if (mounted.current && revision === requestRevision.current) setEnabled(value);
    } catch (loadError) {
      if (mounted.current && revision === requestRevision.current) {
        setError(`自动切换设置读取失败：${String(loadError)}`);
      }
    } finally {
      if (mounted.current && revision === requestRevision.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    mounted.current = true;
    void listen<boolean>('auto-switch-settings-updated', (event) => {
      if (disposed) return;
      requestRevision.current += 1;
      setEnabled(event.payload);
      setIsLoading(false);
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch(() => {
      // 原生设置仍可读取和保存；重新进入页面时也会重读持久化设置。
    }).finally(() => {
      if (!disposed) void reload();
    });
    return () => {
      disposed = true;
      mounted.current = false;
      requestRevision.current += 1;
      unlisten?.();
    };
  }, [reload]);

  const toggle = async () => {
    if (enabled === null || isLoading || saving.current) return;
    const next = !enabled;
    saving.current = true;
    setIsSaving(true);
    setError(null);
    try {
      await invoke('set_auto_switch_enabled', { enabled: next });
      if (mounted.current) {
        requestRevision.current += 1;
        setEnabled(next);
      }
    } catch (saveError) {
      if (mounted.current) setError(`自动切换设置保存失败：${String(saveError)}`);
    } finally {
      saving.current = false;
      if (mounted.current) setIsSaving(false);
    }
  };

  return { enabled, isLoading, isSaving, error, toggle, reload };
}
