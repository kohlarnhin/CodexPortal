import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

export default function CodexInfo() {
  const [versionInfo, setVersionInfo] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchInfo = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      // 后端每次实时检测：覆盖应用启动后才安装/更新 codex 的情况
      const v = await invoke<string>('get_codex_version');

      // Clean up the output if it contains warnings
      const lines = v.split('\n');
      const cleanLines = lines.filter(line => !line.startsWith('WARNING:'));

      setVersionInfo(cleanLines.join('\n').trim() || v);
    } catch (err: any) {
      console.error('Failed to get codex version', err);
      setError(err.toString());
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchInfo();
  }, [fetchInfo]);

  return (
    <div className="max-w-4xl mx-auto w-full pt-4 pb-12 flex flex-col h-full">
      <div className="flex items-center justify-between mb-8 shrink-0">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight text-black mb-1">Codex 信息</h2>
          <p className="text-[13px] text-[#666666]">实时检测本机的 Codex 引擎版本（覆盖独立安装与桌面版内置）。</p>
        </div>
        <button
          type="button"
          onClick={() => void fetchInfo()}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium text-white bg-black rounded-md hover:bg-[#333333] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
        >
          {isLoading && (
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
          )}
          {isLoading ? '检测中...' : '重新检测'}
        </button>
      </div>

      <div className="flex-1">
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

            <div className="space-y-6">
              <div>
                <label className="block text-[12px] font-medium text-[#888888] mb-2 uppercase tracking-wider">Codex 版本信息</label>
                <div className="bg-[#F9F9F9] border border-[#EAEAEA] rounded-md p-4 font-mono text-[13px] text-[#333333] whitespace-pre-wrap shadow-inner relative">
                  {isLoading ? (
                    <span className="text-[#888888] animate-pulse">正在查询...</span>
                  ) : error ? (
                    <span className="text-[#F92672]">查询失败: {error}</span>
                  ) : (
                    versionInfo || '未知版本'
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
