import React, { useLayoutEffect, useRef, useState } from 'react';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { useLogs } from '../hooks/useLogs';
import { LOG_DISPLAY_LIMIT, type LogLevel } from '../types/log';
import ToggleSwitch from './ToggleSwitch';
import Button from './ui/button';
import PageHeader from './ui/page-header';

const TIME_FORMAT = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
const LEVEL_STYLES: Record<LogLevel, { label: string; className: string }> = {
  info: { label: '信息', className: 'bg-muted text-muted-foreground' },
  warn: { label: '警告', className: 'bg-amber-50 text-amber-700' },
  error: { label: '错误', className: 'bg-red-50 text-destructive' },
};

function formatTime(timestamp: string) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : TIME_FORMAT.format(date);
}

export default function LogsPage() {
  const { entries, filePath, fileError, isLoading, isLive, error, reconnect } = useLogs();
  const [isFollowing, setIsFollowing] = useState(true);
  const [openError, setOpenError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const newestSequence = entries[entries.length - 1]?.sequence;

  useLayoutEffect(() => {
    if (isFollowing && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [newestSequence, isFollowing]);

  const revealLogFile = async () => {
    if (!filePath) return;
    setOpenError(null);
    try {
      await revealItemInDir(filePath);
    } catch (err) {
      setOpenError(`打开日志文件位置失败：${String(err)}`);
    }
  };

  return (
    <div className="page-layout pt-4">
      <PageHeader
        title="日志"
        description={`实时展示应用运行日志，窗口仅保留最新 ${LOG_DISPLAY_LIMIT} 条。`}
        actions={
          <Button variant="outline" size="sm" disabled={!filePath} onClick={() => void revealLogFile()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2Z"/></svg>
            打开日志文件位置
          </Button>
        }
      />

      {error && (
        <div role="alert" className="mb-3 shrink-0 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-2.5 text-[12px] text-destructive">
          <span className="min-w-0 break-words">{error}</span>
          <Button variant="outline" size="sm" onClick={reconnect}>重新连接</Button>
        </div>
      )}
      {(fileError || openError) && (
        <div role="alert" className="mb-3 shrink-0 rounded-lg border border-amber-100 bg-amber-50 px-4 py-2.5 text-[12px] text-amber-800 break-words">
          {fileError ? `日志文件不可用：${fileError}。当前日志仍会实时显示。` : openError}
        </div>
      )}

      <div className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2.5 text-[12px]">
            <span className={`h-1.5 w-1.5 rounded-full ${isLive ? 'bg-emerald-500' : 'bg-neutral-300'}`} aria-hidden="true" />
            <span className="font-medium text-foreground">{isLoading ? '正在连接' : isLive ? '实时日志' : '连接中断'}</span>
            <span className="text-muted-foreground/70 tabular-nums">{entries.length} / {LOG_DISPLAY_LIMIT} 条</span>
          </div>
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <span>自动滚动</span>
            <ToggleSwitch size="sm" checked={isFollowing} label="自动滚动到最新日志" onToggle={() => setIsFollowing(current => !current)} />
          </div>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
          onScroll={(event) => {
            const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
            if (isFollowing && scrollHeight - scrollTop - clientHeight > 40) setIsFollowing(false);
          }}
          role="log"
          aria-label="应用实时日志"
          aria-live="polite"
          aria-relevant="additions"
          aria-busy={isLoading}
          tabIndex={0}
        >
          {entries.length === 0 ? (
            <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-2 px-6 text-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#BBBBBB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>
              <p className="text-[13px] text-muted-foreground">{isLoading ? '正在读取最近日志…' : '暂无日志'}</p>
              <p className="text-[12px] text-muted-foreground/70">新日志产生后会自动显示在这里。</p>
            </div>
          ) : (
            <ol className="divide-y divide-border">
              {entries.map(entry => {
                const level = LEVEL_STYLES[entry.level];
                return (
                  <li key={entry.sequence} className="grid grid-cols-[72px_42px_minmax(0,1fr)] items-start gap-3 px-4 py-3 hover:bg-muted/50">
                    <time dateTime={entry.timestamp} title={new Date(entry.timestamp).toLocaleString('zh-CN')} className="pt-0.5 font-mono text-[11px] text-muted-foreground/70 tabular-nums">
                      {formatTime(entry.timestamp)}
                    </time>
                    <span className={`mt-0.5 rounded-md px-1.5 py-0.5 text-center text-[10px] font-medium ${level.className}`}>{level.label}</span>
                    <div className="min-w-0">
                      <span className="mb-0.5 block font-mono text-[10px] leading-4 text-muted-foreground/70">{entry.source}</span>
                      <p className="whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-foreground">{entry.message}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div className="shrink-0 border-t bg-muted/40 px-4 py-2.5 text-[11px] leading-5 text-muted-foreground/70">
          超过 {LOG_DISPLAY_LIMIT} 条时，最旧的一条仅移出窗口；历史日志继续保留在日志文件中。
        </div>
      </div>
    </div>
  );
}
