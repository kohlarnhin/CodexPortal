import React, { useState, useEffect } from 'react';
import { getVersion, getName, getTauriVersion } from '@tauri-apps/api/app';
import type { UpdaterController } from '../hooks/useUpdater';
import Logo from './Logo';
import { cn } from '../lib/utils';
import Button from './ui/button';
import PageHeader from './ui/page-header';

interface AboutProps {
  updater: UpdaterController;
}

export default function About({ updater }: AboutProps) {
  const [appVersion, setAppVersion] = useState<string>('0.3.8');
  const [appName, setAppName] = useState<string>('Codex Portal');
  const [tauriVersion, setTauriVersion] = useState<string>('2.11.5');

  useEffect(() => {
    let cancelled = false;

    const fetchAppInfo = async () => {
      try {
        const [v, n, t] = await Promise.all([getVersion(), getName(), getTauriVersion()]);
        if (cancelled) return;
        if (v) setAppVersion(v);
        if (n) setAppName(n);
        if (t) setTauriVersion(t);
      } catch (err) {
        console.error('Failed to load app info:', err);
      }
    };

    void fetchAppInfo();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasPendingUpdate =
    updater.pendingVersion !== null && updater.pendingVersion !== appVersion;

  const updateStatus = updater.status === 'checking'
    ? '正在检查...'
    : hasPendingUpdate
      ? `有新版本 v${updater.pendingVersion}`
      : updater.status === 'up-to-date'
        ? '已是最新版本'
        : updater.status === 'error'
          ? '检查失败'
          : '自动检查已启用';

  const updateStatusColor = updater.status === 'error'
    ? 'bg-red-500'
    : hasPendingUpdate
      ? 'bg-amber-500'
      : updater.status === 'up-to-date'
        ? 'bg-emerald-500'
        : 'bg-neutral-400';

  return (
    <div className="page-layout pt-4">
      <PageHeader title="关于" description="关于 Codex Portal 应用程序" />

      <div className="page-scroll">
        <div className="mx-auto flex w-full max-w-md flex-col items-center pt-6 text-center">
          <Logo className="h-14 w-14 rounded-xl" />
          <h1 className="mt-4 text-[20px] font-semibold tracking-tight text-foreground select-none">{appName}</h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
            Codex 账号与本地环境配置的管理入口，帮助你轻松切换账号、管理会话与配置。
          </p>

          <div className="mt-6 w-full divide-y rounded-xl border bg-card text-left shadow-xs">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-[13px] text-muted-foreground">应用程序版本</span>
              <span className="font-mono text-[13px] font-medium text-foreground">{appVersion}</span>
            </div>

            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-[13px] text-muted-foreground">Tauri 核心版本</span>
              <span className="font-mono text-[13px] font-medium text-foreground">{tauriVersion}</span>
            </div>

            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="text-[13px] text-muted-foreground">软件更新</div>
                <div className="mt-1 inline-flex items-center gap-1.5 text-[12px]">
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', updateStatusColor)} />
                  <span className={updater.status === 'error' ? 'font-medium text-destructive' : 'text-foreground'}>
                    {updateStatus}
                  </span>
                </div>
              </div>
              <Button
                variant={hasPendingUpdate ? 'default' : 'outline'}
                size="sm"
                onClick={() => void updater.checkNow()}
                disabled={updater.status === 'checking' || updater.isBusy}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={cn(updater.status === 'checking' && 'animate-spin')}
                >
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
                {updater.status === 'checking'
                  ? '检查中...'
                  : hasPendingUpdate
                    ? '立即更新'
                    : updater.status === 'error'
                      ? '重试'
                      : '检查更新'}
              </Button>
            </div>
          </div>

          <div className="mt-6 text-[11.5px] text-muted-foreground">
            © {new Date().getFullYear()} Codex Portal. All rights reserved.
          </div>
        </div>
      </div>
    </div>
  );
}
