import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import Button from './ui/button';
import PageHeader from './ui/page-header';
import { Monitor, RefreshCw, Terminal } from 'lucide-react';

interface CodexVersions {
  cli: string | null;
  desktop: string | null;
}

const VERSION_ENTRIES = [
  {
    key: 'cli',
    label: 'Codex CLI',
    description: '独立安装的命令行版本',
    icon: Terminal,
  },
  {
    key: 'desktop',
    label: 'ChatGPT 桌面版',
    description: '桌面端内置的 Codex 引擎版本',
    icon: Monitor,
  },
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
    <div className="page-layout">
      <PageHeader title="Codex 信息" description="检测本地 CLI 与桌面端内置 Codex 引擎版本。" />

      <div className="page-scroll flex flex-col">
        <div className="mx-auto my-auto flex w-full max-w-[460px] flex-col items-center py-6 pb-10 text-center">
          <div className="grid size-16 place-items-center rounded-[16px] bg-[var(--button-fill)] text-foreground select-none">
            <Terminal size={26} strokeWidth={1.8} />
          </div>

          <h2 className="mt-4 text-heading font-semibold tracking-[-0.015em] text-foreground select-none">
            本地 Codex 引擎
          </h2>
          <p className="mt-1.5 max-w-sm text-body leading-relaxed text-muted-foreground">
            实时检测本机独立安装的命令行版本与 ChatGPT 桌面端内置引擎。
          </p>

          <div
            role="status"
            aria-live="polite"
            aria-busy={isLoading}
            className="bento-group mt-6 w-full overflow-hidden text-left"
          >
            {VERSION_ENTRIES.map(({ key, label, description, icon: Icon }) => {
              const version = versionInfo?.[key];
              return (
                <div key={key} className="bento-list-row py-3.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--button-fill)] text-muted-foreground">
                      <Icon size={15} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-subtitle font-medium text-foreground">{label}</div>
                      <div className="mt-0.5 text-label text-muted-foreground">{description}</div>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {isLoading ? (
                      <span className="text-label text-muted-foreground">正在查询…</span>
                    ) : (
                      <>
                        <span
                          className={
                            version
                              ? 'font-mono text-body font-semibold text-foreground tabular-nums select-text'
                              : 'font-mono text-body text-[var(--label)]'
                          }
                        >
                          {version ?? '—'}
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
                          <span
                            className="bento-status-dot"
                            data-tone={version ? 'running' : 'idle'}
                            aria-hidden="true"
                          />
                          {version ? '已安装' : '未安装'}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchInfo()}
            disabled={isLoading}
            className="mt-5"
          >
            <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
            {isLoading ? '检测中…' : '重新检测'}
          </Button>
        </div>
      </div>
    </div>
  );
}
