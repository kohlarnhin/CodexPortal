import { useCallback, useEffect, useRef, useState } from 'react';
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
  checkNow: () => Promise<void>;
  installUpdate: () => Promise<void>;
  closeModal: () => void;
}

const CHECK_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

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
  const checkingRef = useRef(false);
  const installingRef = useRef(false);
  const updateRef = useRef<Update | null>(null);

  const checkForUpdates = useCallback(async (showResult: boolean) => {
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
        setIsModalOpen(true);
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
  }, []);

  const checkNow = useCallback(async () => {
    if (updateRef.current) {
      setIsModalOpen(true);
      return;
    }

    await checkForUpdates(true);
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

  useEffect(() => {
    if (!import.meta.env.PROD) return;

    const timer = window.setTimeout(() => {
      void checkForUpdates(false);
    }, 1_500);

    return () => window.clearTimeout(timer);
  }, [checkForUpdates]);

  const isBusy = status === 'downloading' || status === 'installing' || status === 'restarting';

  return {
    status,
    update,
    error,
    downloadProgress,
    isModalOpen,
    isBusy,
    checkNow,
    installUpdate,
    closeModal,
  };
}
