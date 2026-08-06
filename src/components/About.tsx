import React, { useState, useEffect } from 'react';
import { getVersion, getName, getTauriVersion } from '@tauri-apps/api/app';
import type { UpdaterController } from '../hooks/useUpdater';
import Logo from './Logo';

interface AboutProps {
  updater: UpdaterController;
}

export default function About({ updater }: AboutProps) {
  const [appVersion, setAppVersion] = useState<string>('...');
  const [appName, setAppName] = useState<string>('...');
  const [tauriVersion, setTauriVersion] = useState<string>('...');

  useEffect(() => {
    let cancelled = false;

    const fetchAppInfo = async () => {
      try {
        const [v, n, t] = await Promise.all([getVersion(), getName(), getTauriVersion()]);
        if (cancelled) return;
        setAppVersion(v);
        setAppName(n);
        setTauriVersion(t);
      } catch (err) {
        console.error('Failed to load app info:', err);
      }
    };
    
    void fetchAppInfo();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateStatus = updater.status === 'checking'
    ? '正在检查...'
    : updater.update
      ? `发现 v${updater.update.version}`
      : updater.status === 'up-to-date'
        ? '已是最新版本'
        : updater.status === 'error'
          ? '检查失败'
          : '自动检查已启用';

  const updateStatusColor = updater.status === 'error'
    ? 'bg-[#D32F2F]'
    : updater.update
      ? 'bg-emerald-500'
      : 'bg-[#B0B0B0]';

  return (
    <div className="max-w-4xl mx-auto w-full h-full flex flex-col pt-4">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight text-black mb-1">关于</h2>
          <p className="text-[13px] text-[#666666]">关于 Codex Portal 应用程序</p>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col pb-4">
        <div className="bg-white rounded-xl shadow-sm border border-[#EAEAEA] flex flex-col items-center justify-center py-10 text-center flex-1">
          
          <div className="mb-4">
            <Logo className="w-16 h-16 shadow-md rounded-2xl" />
          </div>
          
          <h1 className="text-[28px] font-black text-black tracking-tighter mb-2">{appName}</h1>
          <p className="text-[14px] text-[#666666] mb-6 max-w-md mx-auto">
            强大而优雅的 Codex 模型管理入口，帮助你轻松管理多种账户与本地环境配置。
          </p>

          <div className="bg-[#F9F9F9] border border-[#EAEAEA] rounded-lg p-5 w-full max-w-md text-left mx-auto">
            <div className="flex justify-between items-center py-2.5 border-b border-[#EAEAEA]">
              <span className="text-[13px] font-medium text-[#666666]">应用程序版本</span>
              <span className="text-[14px] font-bold text-black">{appVersion}</span>
            </div>
            <div className="flex justify-between items-center py-2.5">
              <span className="text-[13px] font-medium text-[#666666]">Tauri 核心版本</span>
              <span className="text-[14px] font-bold text-black">{tauriVersion}</span>
            </div>
            <div className="flex justify-between items-center py-2.5 border-t border-[#EAEAEA]">
              <div>
                <span className="text-[13px] font-medium text-[#666666]">软件更新</span>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${updateStatusColor}`}></span>
                  <span className={`text-[11px] ${updater.status === 'error' ? 'text-[#D32F2F]' : 'text-[#999999]'}`}>
                    {updateStatus}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void updater.checkNow()}
                disabled={updater.status === 'checking' || updater.isBusy}
                className="px-3 py-1.5 bg-white border border-[#DADADA] text-[12px] font-medium text-[#444444] rounded-md hover:border-black hover:text-black hover:shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={updater.status === 'checking' ? 'animate-spin' : ''}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                {updater.status === 'checking' ? '检查中' : updater.update ? '查看更新' : '检查更新'}
              </button>
            </div>
          </div>
          
          <div className="mt-8 text-[12px] text-[#999999]">
            © {new Date().getFullYear()} Codex Portal. All rights reserved.
          </div>
        </div>
      </div>
    </div>
  );
}
