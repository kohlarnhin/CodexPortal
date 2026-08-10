import { useEffect, useState } from 'react';
import { enable, disable } from '@tauri-apps/plugin-autostart';

const AUTOSTART_STORAGE_KEY = 'codex-portal.autostart-enabled';

/**
 * 开机自启动偏好。
 *
 * 首次运行（无已保存偏好）默认开启；后续以 localStorage 中保存的用户偏好为准，
 * 并在挂载时把操作系统状态同步到该偏好，保证两者一致。
 */
export function useAutostart() {
  const [isEnabled, setIsEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let disposed = false;

    (async () => {
      let pref: string | null = null;
      try {
        pref = window.localStorage.getItem(AUTOSTART_STORAGE_KEY);
      } catch {
        // 无持久化存储时按默认开启处理。
      }

      const target = pref !== 'false';
      try {
        if (target) {
          await enable();
        } else {
          await disable();
        }
        if (!disposed) setIsEnabled(target);
      } catch (error) {
        console.error('开机自启动初始化失败', error);
      } finally {
        if (!disposed) setIsLoading(false);
      }
    })();

    return () => {
      disposed = true;
    };
  }, []);

  const toggleAutostart = async (value: boolean) => {
    setIsEnabled(value);
    try {
      if (value) {
        await enable();
      } else {
        await disable();
      }
      try {
        window.localStorage.setItem(AUTOSTART_STORAGE_KEY, String(value));
      } catch {
        // 持久化失败时仅保留内存状态。
      }
    } catch (error) {
      console.error('开机自启动切换失败', error);
      setIsEnabled(!value);
    }
  };

  return {
    isEnabled,
    isLoading,
    toggleAutostart,
  };
}
