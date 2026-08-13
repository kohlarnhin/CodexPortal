import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';

export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'restarting'
  | 'error';

export interface UpdaterController {
  status: UpdaterStatus;
  update: Update | null;
  error: string | null;
  downloadProgress: number | null;
  isModalOpen: boolean;
  isBusy: boolean;
  /** 已提醒过用户的新版本号（入库记录），用于"关于"页提示与抑制重复弹窗。 */
  pendingVersion: string | null;
  /** 每次自动检测到新版本并弹出更新窗时递增，App 监听后跳转到"关于"页。 */
  promptRevision: number;
  checkNow: () => Promise<void>;
  installUpdate: () => Promise<void>;
  closeModal: () => void;
}

const CHECK_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
/** 自动检查间隔：1 小时。 */
const AUTO_CHECK_INTERVAL_MS = 60 * 60 * 1000;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || '发生未知错误');
}

export function useUpdater(): UpdaterController {
  const [status, setStatus] = useState<UpdaterStatus>('idle');
  const [update, setUpdate] = useState<Update | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [pendingVersion, setPendingVersion] = useState<string | null>(null);
  const [promptRevision, setPromptRevision] = useState(0);
  const checkingRef = useRef(false);
  const installingRef = useRef(false);
  const updateRef = useRef<Update | null>(null);

  /** 记录已提醒过的新版本号到数据库，并同步本地状态。 */
  const recordPending = useCallback(async (version: string) => {
    setPendingVersion(version);
    try {
      await invoke('set_pending_update', { version });
    } catch (err) {
      console.error('Failed to record pending update:', err);
    }
  }, []);

  const checkForUpdates = useCallback(
    async (showResult: boolean, isAuto: boolean) => {
      if (checkingRef.current || installingRef.current) return;

      checkingRef.current = true;
      setStatus('checking');
      setError(null);

      try {
        const nextUpdate = await check({ timeout: CHECK_TIMEOUT_MS });
        const previousUpdate = updateRef.current;

        if (previousUpdate && previousUpdate !== nextUpdate) {
          void previousUpdate.close().catch(() => undefined);
        }

        updateRef.current = nextUpdate;
        setUpdate(nextUpdate);

        if (nextUpdate) {
          setStatus('available');
          // 自动检查（启动 / 1 小时定时）：已提醒过该版本则不重复弹窗；
          // 手动点击"检查更新"始终弹出。检测到新版本即记录入库。
          const shouldPrompt = !isAuto || pendingVersion !== nextUpdate.version;
          await recordPending(nextUpdate.version);
          if (shouldPrompt) {
            setIsModalOpen(true);
            setPromptRevision(revision => revision + 1);
          }
        } else {
          setStatus('up-to-date');
          if (showResult) setIsModalOpen(false);
        }
      } catch (checkError) {
        setStatus('error');
        setError(`检查更新失败：${getErrorMessage(checkError)}`);
      } finally {
        checkingRef.current = false;
      }
    },
    [pendingVersion, recordPending],
  );

  const checkNow = useCallback(async () => {
    if (updateRef.current) {
      setIsModalOpen(true);
      return;
    }

    await checkForUpdates(true, false);
  }, [checkForUpdates]);

  const installUpdate = useCallback(async () => {
    const pendingUpdate = updateRef.current;
    if (!pendingUpdate || installingRef.current) return;

    installingRef.current = true;
    setError(null);
    setStatus('downloading');
    setDownloadProgress(null);

    let downloadedBytes = 0;
    let contentLength: number | undefined;

    const handleDownloadEvent = (event: DownloadEvent) => {
      if (event.event === 'Started') {
        contentLength = event.data.contentLength;
        setDownloadProgress(contentLength && contentLength > 0 ? 0 : null);
        return;
      }

      if (event.event === 'Progress') {
        downloadedBytes += event.data.chunkLength;
        if (contentLength && contentLength > 0) {
          const nextProgress = Math.min(99, Math.round((downloadedBytes / contentLength) * 100));
          setDownloadProgress((current) => current === nextProgress ? current : nextProgress);
        }
        return;
      }

      setDownloadProgress(100);
      setStatus('installing');
    };

    try {
      await pendingUpdate.downloadAndInstall(handleDownloadEvent, {
        timeout: DOWNLOAD_TIMEOUT_MS,
      });
      setStatus('restarting');
      await relaunch();
    } catch (installError) {
      installingRef.current = false;
      setStatus('error');
      setError(`安装更新失败：${getErrorMessage(installError)}`);
    }
  }, []);

  const closeModal = useCallback(() => {
    if (installingRef.current) return;
    setIsModalOpen(false);
  }, []);

  // 启动：加载已记录的新版本 + 异步检查一次（有更新则弹窗并跳转关于页）。
  useEffect(() => {
    if (!import.meta.env.PROD) return;

    let cancelled = false;

    (async () => {
      try {
        const recorded = await invoke<string | null>('get_pending_update');
        if (cancelled) return;
        if (recorded) setPendingVersion(recorded);
      } catch (err) {
        console.error('Failed to load pending update:', err);
      }
    })();

    const timer = window.setTimeout(() => {
      void checkForUpdates(false, true);
    }, 1_500);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [checkForUpdates]);

  // 1 小时自动检查一次：同样遵守"已提醒过不重复弹窗"。
  useEffect(() => {
    if (!import.meta.env.PROD) return;

    const interval = window.setInterval(() => {
      void checkForUpdates(false, true);
    }, AUTO_CHECK_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [checkForUpdates]);

  const isBusy = status === 'downloading' || status === 'installing' || status === 'restarting';

  return {
    status,
    update,
    error,
    downloadProgress,
    isModalOpen,
    isBusy,
    pendingVersion,
    promptRevision,
    checkNow,
    installUpdate,
    closeModal,
  };
}
