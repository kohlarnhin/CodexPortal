import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { useLogs } from '../hooks/useLogs';
import { LOG_DISPLAY_LIMIT, type LogLevel } from '../types/log';
import ToggleSwitch from './ToggleSwitch';
import SegmentedControl from './SegmentedControl';
import Button from './ui/button';
import PageHeader from './ui/page-header';
import { FolderOpen } from 'lucide-react';

const TIME_FORMAT = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

const LEVEL_META: Record<LogLevel, { label: string; textClass: string }> = {
  info: { label: 'INFO', textClass: 'text-[#d1d1d6]' },
  warn: { label: 'WARN', textClass: 'text-[#ffd60a]' },
  error: { label: 'ERR ', textClass: 'text-[#ff453a] font-semibold' },
};

type LogFilter = 'all' | 'problems' | 'error';

function formatTime(timestamp: string) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : TIME_FORMAT.format(date);
}

export default function LogsPage() {
  const { entries, filePath, fileError, isLoading, isLive, error, reconnect } = useLogs();
  const [isFollowing, setIsFollowing] = useState(true);
  const [filter, setFilter] = useState<LogFilter>('all');
  const [openError, setOpenError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const newestSequence = entries[entries.length - 1]?.sequence;

  const counts = useMemo(() => {
    let warnings = 0;
    let errors = 0;
    for (const entry of entries) {
      if (entry.level === 'warn') warnings += 1;
      else if (entry.level === 'error') errors += 1;
    }
    return { warnings, errors };
  }, [entries]);

  const filteredEntries = useMemo(() => {
    if (filter === 'all') return entries;
    if (filter === 'error') return entries.filter(e => e.level === 'error');
    return entries.filter(e => e.level !== 'info');
  }, [entries, filter]);

  useLayoutEffect(() => {
    if (isFollowing && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [newestSequence, isFollowing, filter]);

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
    <div className="page-layout">
      <PageHeader
        title="日志"
        badge={
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground tabular-nums">
            <span
              className="bento-status-dot"
              data-tone={isLive ? 'running' : 'idle'}
              aria-hidden="true"
            />
            {isLoading ? '正在连接' : isLive ? '实时日志' : '连接中断'} · {entries.length} / {LOG_DISPLAY_LIMIT} 条
          </span>
        }
        actions={
          <>
            <div className="flex items-center gap-2 text-label text-muted-foreground mr-1">
              <span>自动滚动</span>
              <ToggleSwitch
                size="sm"
                checked={isFollowing}
                label="自动滚动到最新日志"
                onToggle={() => setIsFollowing(current => !current)}
              />
            </div>
            <Button variant="outline" size="sm" disabled={!filePath} onClick={() => void revealLogFile()}>
              <FolderOpen size={13.5} aria-hidden="true" />
              日志文件位置
            </Button>
          </>
        }
      />

      <div className="page-body gap-3">
        {error && (
          <div role="alert" className="bento-card flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-label text-destructive">
            <span className="min-w-0 break-words">{error}</span>
            <Button variant="outline" size="sm" onClick={reconnect}>重新连接</Button>
          </div>
        )}
        {(fileError || openError) && (
          <div role="alert" className="bento-card shrink-0 px-4 py-2.5 text-label text-warning break-words">
            {fileError ? `日志文件不可用：${fileError}。当前日志仍会实时显示。` : openError}
          </div>
        )}

        {/* Bento 深色控制台输出面板 */}
        <section className="bento-console flex-1">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 pt-3 pb-2.5 border-b border-white/[0.08]">
            <SegmentedControl<LogFilter>
              size="sm"
              label="过滤日志级别"
              value={filter}
              onChange={setFilter}
              options={[
                { id: 'all', label: '全部' },
                { id: 'problems', label: '仅问题' },
                { id: 'error', label: '仅错误' },
              ]}
            />
            <div className="flex items-center gap-3 font-mono text-[11.5px] tabular-nums">
              {counts.errors > 0 && <span className="font-semibold text-[#ff453a]">{counts.errors} 条错误</span>}
              <span className={counts.warnings > 0 ? 'text-[#ffd60a]' : 'text-[#8e8e93]'}>
                {counts.warnings} 条警告
              </span>
            </div>
          </div>

          <div
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-2.5 font-mono text-[12px] leading-[22px] select-text"
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
            {filteredEntries.length === 0 ? (
              <p className="pt-2 text-[#8e8e93]">
                {entries.length > 0
                  ? '没有符合当前筛选条件的日志'
                  : isLoading
                    ? '正在读取最近日志…'
                    : '暂无日志，新日志产生后会实时显示在这里'}
              </p>
            ) : (
              <ol className="space-y-0.5">
                {filteredEntries.map(entry => {
                  const meta = LEVEL_META[entry.level];
                  return (
                    <li
                      key={entry.sequence}
                      className="flex items-baseline gap-2.5 rounded-[6px] px-1.5 py-0.5 hover:bg-white/[0.04]"
                    >
                      <time
                        dateTime={entry.timestamp}
                        title={new Date(entry.timestamp).toLocaleString('zh-CN')}
                        className="shrink-0 text-[11px] text-[#8e8e93] tabular-nums"
                      >
                        {formatTime(entry.timestamp)}
                      </time>
                      <span className="shrink-0 text-[11px] text-[#a1a1a6] max-w-[110px] truncate" title={entry.source}>
                        [{entry.source}]
                      </span>
                      <span className={`min-w-0 flex-1 whitespace-pre-wrap break-words ${meta.textClass}`}>
                        {entry.level !== 'info' && <span className="mr-1.5 text-[11px]">{meta.label.trim()}</span>}
                        {entry.message}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          <div className="shrink-0 border-t border-white/[0.08] px-4 py-2 text-[11px] text-[#8e8e93]">
            窗口保留最新 {LOG_DISPLAY_LIMIT} 条；历史日志持续写入本地日志文件。
          </div>
        </section>
      </div>
    </div>
  );
}
