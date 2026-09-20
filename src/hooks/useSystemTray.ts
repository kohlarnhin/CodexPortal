import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { renderTrayIcon, type TrayIconState } from '../utils/trayIcon';

interface TraySettings {
  enabled: boolean;
  error: string | null;
}

export function useSystemTray(isEmailMaskingEnabled: boolean, onNavigate: (page: string) => void) {
  const [isEnabled, setIsEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    let disposed = false;
    void invoke<TraySettings>('get_tray_settings').then((settings) => {
      if (!disposed) {
        setIsEnabled(settings.enabled);
        setError(settings.error);
      }
    }).catch(() => {
      if (!disposed) setError('托盘设置读取失败，请重新开启托盘。');
    }).finally(() => {
      if (!disposed) setIsLoading(false);
    });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<string>('tray-navigate', ({ payload }) => {
      if (!disposed && (payload === 'app-settings' || payload === 'accounts' || payload === 'dashboard')) onNavigate(payload);
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch(() => {
      if (!disposed) setError('托盘页面导航初始化失败，请重启应用。');
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [onNavigate]);

  useEffect(() => {
    let disposed = false;
    let revision = -1;
    let unlisten: (() => void) | undefined;
    const updateIcon = async (state: TrayIconState) => {
      if (disposed || state.revision < revision) return;
      revision = state.revision;
      try {
        await invoke('set_tray_icon', { pixels: renderTrayIcon(state) });
      } catch {
        if (!disposed) setError('托盘图标更新失败，请重新开启托盘。');
      }
    };
    void listen<TrayIconState>('tray-icon-state', ({ payload }) => { void updateIcon(payload); })
      .then(async (stop) => {
        if (disposed) { stop(); return; }
        unlisten = stop;
        // 注册监听后补读，覆盖主窗口加载前已生成的额度状态。
        await updateIcon(await invoke<TrayIconState>('get_tray_icon_state'));
      }).catch(() => {
        if (!disposed) setError('托盘图标初始化失败，请重启应用。');
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    void invoke('set_tray_email_masking', { enabled: isEmailMaskingEnabled }).catch(() => {
      if (!disposed) setError('托盘邮箱显示设置同步失败，请重试。');
    });
    return () => { disposed = true; };
  }, [isEmailMaskingEnabled]);

  const toggle = async () => {
    if (isLoading || saving.current) return;
    saving.current = true;
    setIsSaving(true);
    setError(null);
    try {
      const settings = await invoke<TraySettings>('set_tray_enabled', { enabled: !isEnabled });
      setIsEnabled(settings.enabled);
      setError(settings.error);
    } catch {
      setError('托盘设置保存失败，请重试。');
    } finally {
      saving.current = false;
      setIsSaving(false);
    }
  };

  return { isEnabled, isLoading, isSaving, error, toggle };
}
