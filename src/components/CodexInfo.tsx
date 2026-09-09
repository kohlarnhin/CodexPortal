import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface CodexVersions {
  cli: string | null;
  desktop: string | null;
}

const VERSION_ENTRIES = [
  { key: 'cli', label: 'Codex CLI', description: '独立安装的命令行版本' },
  { key: 'desktop', label: '桌面版 Codex', description: 'ChatGPT / Codex 桌面端内置引擎版本' },
] as const;

export default function CodexInfo() {
  const [versionInfo, setVersionInfo] = useState<CodexVersions | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchInfo = useCallback(async () => {
    setIsLoading(true);
    setVersionInfo(null);
    try {
      setVersionInfo(await invoke<CodexVersions>('get_codex_versions'));
    } catch (err) {
      console.error('Failed to get Codex versions', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchInfo();
  }, [fetchInfo]);

  return (
    <div className="page-layout pt-4">
      <div className="page-header">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight text-black mb-1">Codex 信息</h2>
          <p className="text-[13px] text-[#666666]">分别检测 CLI 与桌面端内置 Codex 版本，未检测到时显示未安装。</p>
        </div>
        <button
          type="button"
          onClick={() => void fetchInfo()}
          disabled={isLoading}
          className="flex shrink-0 items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium text-white bg-black rounded-md hover:bg-[#333333] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
        >
          {isLoading && (
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
          )}
          {isLoading ? '检测中...' : '重新检测'}
        </button>
      </div>

      <div className="page-scroll">
        <div className="bg-white rounded-xl shadow-sm border border-[#EAEAEA] overflow-hidden">
          <div className="p-8">
            <div className="flex items-center gap-5 mb-8">
              <div className="w-16 h-16 bg-[#F5F5F5] rounded-xl flex items-center justify-center border border-[#EAEAEA]">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
              </div>
              <div>
                <h3 className="text-[24px] font-bold text-black tracking-tight mb-1">本机环境状态</h3>
                <p className="text-[14px] text-[#666666]">通过系统调用查询</p>
              </div>
            </div>

            <div className="grid grid-cols-1 @min-[640px]/page:grid-cols-2 gap-6">
              {VERSION_ENTRIES.map(({ key, label, description }) => (
                <div key={key} className="min-w-0 flex flex-col">
                  <h4 className="text-[14px] font-medium text-[#333333] mb-1">{label}</h4>
                  <p className="text-[12px] text-[#888888] mb-3">{description}</p>
                  <div role="status" aria-live="polite" aria-busy={isLoading} className="mt-auto bg-[#F9F9F9] border border-[#EAEAEA] rounded-md p-4 font-mono text-[13px] text-[#333333] break-all shadow-inner relative">
                    {isLoading ? (
                      <span className="text-[#888888] animate-pulse">正在查询...</span>
                    ) : versionInfo?.[key] ? (
                      versionInfo[key]
                    ) : (
                      <span className="text-[#888888]">未安装</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
