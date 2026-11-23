import { useState, useEffect } from 'react';
import { getVersion, getName, getTauriVersion } from '@tauri-apps/api/app';
import type { UpdaterController } from '../hooks/useUpdater';
import Logo from './Logo';
import { cn } from '../lib/utils';
import Button from './ui/button';
import PageHeader from './ui/page-header';
import { RotateCcw } from 'lucide-react';
import { isVersionNewer } from '../utils/version';

interface AboutProps {
  updater: UpdaterController;
}

export default function About({ updater }: AboutProps) {
  const [appVersion, setAppVersion] = useState<string>('0.5.1');
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
    updater.pendingVersion !== null && isVersionNewer(updater.pendingVersion, appVersion);

  const updateStatus = updater.status === 'checking'
    ? '正在检查…'
    : hasPendingUpdate
      ? `有新版本 v${updater.pendingVersion}`
      : updater.status === 'up-to-date'
        ? '已是最新版本'
        : updater.status === 'error'
          ? '检查失败'
          : '自动检查已启用';

  const updateTone = updater.status === 'error'
    ? 'error'
    : hasPendingUpdate
      ? 'warning'
      : updater.status === 'up-to-date'
        ? 'success'
        : 'idle';

  return (
    <div className="page-layout">
      <PageHeader title="关于" description="关于 Codex Portal 应用程序与更新状态。" />

      <div className="page-scroll flex flex-col">
        <div className="mx-auto my-auto flex w-full max-w-[460px] flex-col items-center py-6 pb-10 text-center">
          <Logo className="size-16 rounded-[16px]" />
          <h1 className="mt-4 text-heading font-semibold tracking-[-0.015em] text-foreground select-none">
            {appName}
          </h1>
          <p className="mt-1.5 max-w-sm text-body leading-relaxed text-muted-foreground">
            Codex 账号与本地环境配置的管理入口，帮助你智能调度账号、管理会话与配置。
          </p>

          <div className="bento-group mt-6 w-full overflow-hidden text-left">
            <div className="bento-list-row">
              <span className="text-body text-muted-foreground">应用程序版本</span>
              <span className="font-mono text-body font-medium text-foreground tabular-nums">v{appVersion}</span>
            </div>

            <div className="bento-list-row">
              <span className="text-body text-muted-foreground">Tauri 核心版本</span>
              <span className="font-mono text-body font-medium text-foreground tabular-nums">v{tauriVersion}</span>
            </div>

            <div className="bento-list-row">
              <div className="min-w-0">
                <div className="text-body text-foreground">软件更新</div>
                <div className="mt-0.5 inline-flex items-center gap-1.5 text-label">
                  <span className="bento-status-dot" data-tone={updateTone} aria-hidden="true" />
                  <span className={updater.status === 'error' ? 'font-medium text-destructive' : 'text-muted-foreground'}>
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
                <RotateCcw size={13} className={cn(updater.status === 'checking' && 'animate-spin')} />
                {updater.status === 'checking'
                  ? '检查中…'
                  : hasPendingUpdate
                    ? '立即更新'
                    : updater.status === 'error'
                      ? '重试'
                      : '检查更新'}
              </Button>
            </div>
          </div>

          <div className="mt-6 text-caption text-[var(--label)]">
            © {new Date().getFullYear()} Codex Portal. All rights reserved.
          </div>
        </div>
      </div>
    </div>
  );
}
