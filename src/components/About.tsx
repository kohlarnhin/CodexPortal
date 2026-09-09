import React, { useState, useEffect } from 'react';
import { getVersion, getName, getTauriVersion } from '@tauri-apps/api/app';
import type { UpdaterController } from '../hooks/useUpdater';
import Logo from './Logo';
import { cn } from '../lib/utils';

interface AboutProps {
  updater: UpdaterController;
}

export default function About({ updater }: AboutProps) {
  const [appVersion, setAppVersion] = useState<string>('0.3.1');
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
      ? 'bg-amber-500 animate-pulse'
      : updater.status === 'up-to-date'
        ? 'bg-emerald-500'
        : 'bg-neutral-400';

  return (
    <div className="page-layout pt-4">
      <div className="mb-3 shrink-0">
        <h2 className="text-[20px] font-semibold tracking-tight text-neutral-900 mb-0.5">关于</h2>
        <p className="text-[13px] text-neutral-500">关于 Codex Portal 应用程序</p>
      </div>

      <div className="flex-1 min-h-0 flex flex-col items-center justify-center rounded-xl border border-neutral-200/80 bg-white shadow-2xs p-6 overflow-hidden">
        <div className="flex flex-col items-center text-center max-w-sm w-full my-auto">
          {/* Logo */}
          <div className="mb-3">
            <Logo className="w-16 h-16 shadow-md rounded-2xl ring-1 ring-black/5 transition-transform duration-300 hover:scale-105" />
          </div>

          {/* App Name */}
          <h1 className="text-[24px] font-extrabold tracking-tight mb-1.5 portal-brand-text select-none">
            {appName}
          </h1>
          <p className="text-[13px] text-neutral-500 leading-relaxed mb-6">
            强大而优雅的 Codex 模型管理入口，帮助你轻松管理多种账户与本地环境配置。
          </p>

          {/* 简洁信息卡片 */}
          <div className="w-full bg-neutral-50/80 border border-neutral-200/80 rounded-xl p-3.5 divide-y divide-neutral-200/60 text-left">
            <div className="flex justify-between items-center py-2.5">
              <span className="text-[12.5px] text-neutral-500">应用程序版本</span>
              <span className="font-mono text-[13px] font-semibold text-neutral-900">{appVersion}</span>
            </div>

            <div className="flex justify-between items-center py-2.5">
              <span className="text-[12.5px] text-neutral-500">Tauri 核心版本</span>
              <span className="font-mono text-[13px] font-semibold text-neutral-900">{tauriVersion}</span>
            </div>

            <div className="flex justify-between items-center py-2.5">
              <span className="text-[12.5px] text-neutral-500">软件更新</span>
              <div className="flex items-center gap-2.5">
                <span className="inline-flex items-center gap-1.5 text-[12px] text-neutral-500">
                  <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", updateStatusColor)} />
                  <span className={cn(
                    updater.status === 'error' ? 'text-red-600 font-medium' : 'text-neutral-500'
                  )}>
                    {updateStatus}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => void updater.checkNow()}
                  disabled={updater.status === 'checking' || updater.isBusy}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium transition-all select-none cursor-pointer disabled:opacity-50",
                    hasPendingUpdate
                      ? "bg-neutral-900 text-white hover:bg-neutral-800 shadow-2xs"
                      : "text-neutral-600 hover:text-neutral-900 bg-neutral-200/60 hover:bg-neutral-200 active:bg-neutral-300/70"
                  )}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={cn("shrink-0", updater.status === 'checking' && "animate-spin")}
                  >
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                  </svg>
                  <span>
                    {updater.status === 'checking'
                      ? '检查中...'
                      : hasPendingUpdate
                        ? '立即更新'
                        : updater.status === 'error'
                          ? '重试'
                          : '检查更新'}
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* 版权声明 */}
          <div className="mt-6 text-[11.5px] text-neutral-400">
            © {new Date().getFullYear()} Codex Portal. All rights reserved.
          </div>
        </div>
      </div>
    </div>
  );
}
