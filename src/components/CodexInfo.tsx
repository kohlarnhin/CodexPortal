import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import Button from './ui/button';
import PageHeader from './ui/page-header';

interface CodexVersions {
  cli: string | null;
  desktop: string | null;
}

const VERSION_ENTRIES = [
  { key: 'cli', label: 'Codex CLI', description: '独立安装的命令行版本' },
  { key: 'desktop', label: 'ChatGPT 桌面版', description: '桌面端内置的 Codex 引擎版本' },
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
      <PageHeader
        title="Codex 信息"
        description="分别检测 CLI 与桌面端内置 Codex 版本，未检测到时显示未安装。"
        actions={
          <Button variant="outline" size="sm" onClick={() => void fetchInfo()} disabled={isLoading}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={isLoading ? 'animate-spin' : ''}><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></svg>
            {isLoading ? '检测中...' : '重新检测'}
          </Button>
        }
      />

      <div className="page-scroll">
        <div className="grid grid-cols-1 gap-4 @min-[640px]/page:grid-cols-2">
          {VERSION_ENTRIES.map(({ key, label, description }) => {
            const version = versionInfo?.[key];
            return (
              <div key={key} className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-5 shadow-xs">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-[14px] font-medium text-foreground">{label}</h3>
                    <p className="mt-1 text-[12.5px] text-muted-foreground">{description}</p>
                  </div>
                  {!isLoading && (
                    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium ${version ? 'text-foreground' : 'text-muted-foreground'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${version ? 'bg-emerald-500' : 'bg-neutral-300'}`} />
                      {version ? '已安装' : '未安装'}
                    </span>
                  )}
                </div>
                <div role="status" aria-live="polite" aria-busy={isLoading} className="mt-auto rounded-md border bg-muted/50 px-3 py-2.5 font-mono text-[12.5px] text-foreground break-all">
                  {isLoading ? (
                    <span className="text-muted-foreground">正在查询...</span>
                  ) : version ? (
                    version
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
