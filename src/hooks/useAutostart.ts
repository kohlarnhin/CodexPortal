import { useEffect, useState } from 'react';
import { enable, disable, isEnabled as isAutostartEnabled } from '@tauri-apps/plugin-autostart';

const AUTOSTART_STORAGE_KEY = 'codex-portal.autostart-enabled';

/**
 * 开发模式（vite dev / tauri dev）下不写入系统登录项。
 *
 * 插件的登录项按应用名唯一，dev 的 debug 二进制与已安装版本共用同一个 plist，
 * 一旦在 dev 里调用 enable() 就会把登录项改指向 target/debug，而该二进制依赖
 * 本地 dev server，开机启动时无法加载页面。因此 dev 只读取状态，不修改。
 */
const IS_DEV = import.meta.env.DEV;

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
      try {
        if (IS_DEV) {
          const enabled = await isAutostartEnabled();
          if (!disposed) setIsEnabled(enabled);
          return;
        }

        let pref: string | null = null;
        try {
          pref = window.localStorage.getItem(AUTOSTART_STORAGE_KEY);
        } catch {
          // 无持久化存储时按默认开启处理。
        }

        const target = pref !== 'false';
        if (target) {
          await enable();
        } else {
          await disable();
        }
        if (!disposed) setIsEnabled(target);
      } catch (error) {
        console.error(IS_DEV ? '读取开机自启动状态失败' : '开机自启动初始化失败', error);
      } finally {
        if (!disposed) setIsLoading(false);
      }
    })();

    return () => {
      disposed = true;
    };
  }, []);

  const toggleAutostart = async (value: boolean) => {
    if (IS_DEV) return;

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
    isReadOnly: IS_DEV,
    toggleAutostart,
  };
}
