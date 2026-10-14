import React, { useState, useEffect } from 'react';
import { getVersion, getName, getTauriVersion } from '@tauri-apps/api/app';
import type { UpdaterController } from '../hooks/useUpdater';
import Logo from './Logo';
import { cn } from '../lib/utils';
import Button from './ui/button';
import PageHeader from './ui/page-header';
import { RotateCcw } from 'lucide-react';

interface AboutProps {
  updater: UpdaterController;
}

export default function About({ updater }: AboutProps) {
  const [appVersion, setAppVersion] = useState<string>('0.3.9');
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
    ? 'bg-destructive'
    : hasPendingUpdate
      ? 'bg-warning'
      : updater.status === 'up-to-date'
        ? 'bg-success'
        : 'bg-muted-foreground/60';

  return (
    <div className="page-layout pt-4">
      <PageHeader title="关于" description="关于 Codex Portal 应用程序" />

      <div className="page-scroll">
        <div className="mx-auto flex w-full max-w-md flex-col items-center pt-6 text-center">
          <Logo className="h-14 w-14 rounded-xl" />
          <h1 className="mt-4 text-heading font-semibold tracking-tight text-foreground select-none">{appName}</h1>
          <p className="mt-1.5 text-body leading-relaxed text-muted-foreground">
            Codex 账号与本地环境配置的管理入口，帮助你轻松切换账号、管理会话与配置。
          </p>

          <div className="mt-6 w-full divide-y rounded-xl border bg-card text-left shadow-xs">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-body text-muted-foreground">应用程序版本</span>
              <span className="font-mono text-body font-medium text-foreground">{appVersion}</span>
            </div>

            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-body text-muted-foreground">Tauri 核心版本</span>
              <span className="font-mono text-body font-medium text-foreground">{tauriVersion}</span>
            </div>

            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="text-body text-muted-foreground">软件更新</div>
                <div className="mt-1 inline-flex items-center gap-1.5 text-label">
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
                <RotateCcw size={14} className={cn(updater.status === 'checking' && 'animate-spin')} />
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

          <div className="mt-6 text-label text-muted-foreground">
            © {new Date().getFullYear()} Codex Portal. All rights reserved.
          </div>
        </div>
      </div>
    </div>
  );
}
