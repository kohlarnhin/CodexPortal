import React, { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { SessionPreviewMessage, SessionRecord } from '../../types/session';
import { formatDateTime, formatFileSize, formatRelativeTime } from '../../utils/time';
import { formatTokens } from '../../utils/format';
import { parseSessionPreview } from '../../utils/sessionContent';
import { findTextMatches, TextMatch } from '../../utils/sessionSearch';
import HighlightedText from './HighlightedText';
import SearchInput from './SearchInput';

const SessionMessage = memo(function SessionMessage({
  message, matches, firstMatchIndex, activeMatchIndex,
}: {
  message: SessionPreviewMessage;
  matches: TextMatch[];
  firstMatchIndex: number;
  activeMatchIndex?: number;
}) {
  return (
    <article className="grid min-w-0 gap-2 border-b border-[#EAEAEA] py-5 last:border-b-0 @min-[640px]/session-detail:grid-cols-[56px_minmax(0,1fr)] @min-[640px]/session-detail:gap-4">
      <p className={`pt-0.5 text-[11px] font-semibold ${message.role === 'user' ? 'text-black' : 'text-[#777777]'}`}>
        {message.role === 'user' ? '用户' : 'Codex'}
      </p>
      <p className="text-[13px] text-[#444444] leading-relaxed whitespace-pre-wrap break-words">
        <HighlightedText text={message.text} matches={matches} firstMatchIndex={firstMatchIndex} activeMatchIndex={activeMatchIndex} />
      </p>
    </article>
  );
});

interface SessionDetailPanelProps {
  session: SessionRecord;
  loadContent: (id: string) => Promise<string>;
  onCopyResume: (session: SessionRecord) => void;
  onRevealInFinder: (session: SessionRecord) => void;
  onClose: () => void;
}

const SessionDetailPanel: React.FC<SessionDetailPanelProps> = ({
  session,
  loadContent,
  onCopyResume,
  onRevealInFinder,
  onClose,
}) => {
  const [messages, setMessages] = useState<SessionPreviewMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeMatch, setActiveMatch] = useState(0);
  const [showInfo, setShowInfo] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const keyword = useDeferredValue(search.trim());
  const isSearching = keyword !== search.trim();
  const searchResults = useMemo(() => {
    let count = 0;
    const items = messages.map(message => {
      const matches = findTextMatches(message.text, keyword);
      const firstMatchIndex = count;
      count += matches.length;
      return { message, matches, firstMatchIndex };
    });
    return { items, count };
  }, [messages, keyword]);
  const activeMatchIndex = searchResults.count > 0 ? Math.min(activeMatch, searchResults.count - 1) : -1;

  const changeSearch = (value: string) => {
    setSearch(value);
    setActiveMatch(0);
  };

  const moveMatch = (direction: number) => {
    if (searchResults.count === 0 || isSearching) return;
    setActiveMatch((activeMatchIndex + direction + searchResults.count) % searchResults.count);
  };

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    panel?.focus({ preventScroll: true });
    return () => {
      if (previousFocus?.isConnected && (panel?.contains(document.activeElement) || document.activeElement === document.body)) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  useEffect(() => {
    if (activeMatchIndex < 0 || isSearching || isLoading) return;
    contentRef.current
      ?.querySelector<HTMLElement>(`[data-search-match="${activeMatchIndex}"]`)
      ?.scrollIntoView({ block: 'center' });
  }, [activeMatchIndex, searchResults, isSearching, isLoading]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const content = await loadContent(session.id);
        if (!cancelled) setMessages(parseSessionPreview(content));
      } catch (err: any) {
        if (!cancelled) setLoadError(err?.toString() || '加载会话内容失败');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.id, loadContent]);

  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      aria-labelledby="session-detail-title"
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
          event.preventDefault();
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          if (search) {
            changeSearch('');
            searchInputRef.current?.focus();
          } else {
            onClose();
          }
        }
      }}
      className="@container/session-detail absolute inset-0 z-20 flex min-h-0 min-w-0 flex-col overflow-hidden bg-[#FAFAFA] outline-none"
    >
      <header className="shrink-0 border-b border-[#EAEAEA] px-5 @min-[640px]/session-detail:px-8">
        <div data-tauri-drag-region className="flex h-12 min-w-0 items-center gap-2">
          <button
            onClick={onClose}
            aria-label="返回会话列表"
            title="返回会话列表（Esc）"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[#666666] hover:bg-black/5 hover:text-black [-webkit-app-region:no-drag]"
          >
            <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <h3 id="session-detail-title" data-tauri-drag-region title={session.title} className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-tight text-black">
            {session.title}
          </h3>
          <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
            <button
              onClick={() => {
                setShowInfo(value => !value);
                if (!showInfo) contentRef.current?.scrollTo({ top: 0 });
              }}
              aria-expanded={showInfo}
              aria-controls="session-detail-info"
              title={showInfo ? '收起会话信息' : '查看会话信息'}
              className={`flex h-7 items-center gap-1.5 rounded px-2 text-[12px] hover:bg-black/5 hover:text-black ${showInfo ? 'text-black' : 'text-[#777777]'}`}
            >
              <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></svg>
              信息
            </button>
            <button
              onClick={() => onRevealInFinder(session)}
              aria-label="在 Finder 中显示"
              title="在 Finder 中显示"
              className="flex h-7 w-7 items-center justify-center rounded text-[#777777] hover:bg-black/5 hover:text-black"
            >
              <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg>
            </button>
            <button
              onClick={() => onCopyResume(session)}
              className="h-7 rounded px-2 text-[12px] font-medium text-black hover:bg-black/5"
            >
              复制恢复命令
            </button>
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-2 pb-2.5" title="⌘/Ctrl+F 搜索 · Enter 下一处 · Shift+Enter 上一处 · Esc 清除或返回">
          <div className="flex min-w-0 max-w-md flex-1">
            <SearchInput
              ref={searchInputRef}
              value={search}
              onChange={changeSearch}
              label="搜索会话内容"
              placeholder="搜索会话内容…"
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  moveMatch(event.shiftKey ? -1 : 1);
                }
              }}
            />
          </div>
          <span role="status" className="min-w-16 shrink-0 text-center text-[11px] tabular-nums text-[#888888]">
            {isLoading ? '读取中…' : loadError ? '读取失败' : isSearching ? '查找中…' : !keyword ? `${messages.length} 条消息` : searchResults.count === 0 ? '无匹配' : `${activeMatchIndex + 1} / ${searchResults.count}`}
          </span>
          <div className="flex shrink-0 items-center">
            <button
              onClick={() => moveMatch(-1)}
              disabled={searchResults.count === 0 || isSearching || isLoading}
              aria-label="上一处匹配"
              title="上一处匹配（Shift+Enter）"
              className="flex h-7 w-7 items-center justify-center rounded text-[#666666] hover:bg-black/5 disabled:opacity-35 disabled:cursor-not-allowed"
            >
              <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6"/></svg>
            </button>
            <button
              onClick={() => moveMatch(1)}
              disabled={searchResults.count === 0 || isSearching || isLoading}
              aria-label="下一处匹配"
              title="下一处匹配（Enter）"
              className="flex h-7 w-7 items-center justify-center rounded text-[#666666] hover:bg-black/5 disabled:opacity-35 disabled:cursor-not-allowed"
            >
              <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
            </button>
          </div>
          <span className="ml-auto hidden min-w-0 truncate text-[11px] text-[#999999] @min-[800px]/session-detail:block">
            {[session.model, session.totalTokens > 0 ? `${formatTokens(session.totalTokens)} tokens` : null].filter(Boolean).join(' · ')}
          </span>
        </div>
      </header>

      <div ref={contentRef} tabIndex={0} aria-label="会话消息" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 outline-none @min-[640px]/session-detail:px-8">
        <section id="session-detail-info" hidden={!showInfo} aria-label="会话信息" className="border-b border-[#EAEAEA] py-4">
          <dl className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-4 gap-y-2 text-[11px] leading-relaxed">
            <dt className="text-[#999999]">标题</dt>
            <dd className="min-w-0 break-words text-[#555555]">{session.title}</dd>
            <dt className="text-[#999999]">会话 ID</dt>
            <dd className="min-w-0 break-all font-mono text-[#555555]">{session.id}</dd>
            <dt className="text-[#999999]">项目</dt>
            <dd className="min-w-0 break-all font-mono text-[#555555]">{session.projectPath}</dd>
            <dt className="text-[#999999]">文件</dt>
            <dd className="min-w-0 break-all font-mono text-[#555555]">{session.filePath}</dd>
            <dt className="text-[#999999]">时间</dt>
            <dd className="flex flex-wrap gap-x-3 gap-y-1 text-[#666666]">
              <span>开始 {formatDateTime(session.startedAt)}</span>
              <span>最近活跃 {formatRelativeTime(session.lastActivityAt)}</span>
            </dd>
            <dt className="text-[#999999]">详情</dt>
            <dd className="flex flex-wrap gap-x-3 gap-y-1 text-[#666666]">
              <span>{session.messageCount} 条消息记录</span>
              <span>{formatFileSize(session.fileSize)}</span>
              {session.model && <span>{session.model}</span>}
              {session.cliVersion && <span>CLI v{session.cliVersion}</span>}
            </dd>
            {session.totalTokens > 0 && (
              <>
                <dt className="text-[#999999]">Token</dt>
                <dd className="flex flex-wrap gap-x-3 gap-y-1 text-[#666666]">
                  <span className="font-medium text-black">合计 {formatTokens(session.totalTokens)}</span>
                  <span>输入 {formatTokens(session.inputTokens)}</span>
                  {session.cachedInputTokens > 0 && <span>缓存命中 {formatTokens(session.cachedInputTokens)}</span>}
                  <span>输出 {formatTokens(session.outputTokens)}</span>
                  {session.reasoningTokens > 0 && <span>推理 {formatTokens(session.reasoningTokens)}</span>}
                </dd>
              </>
            )}
          </dl>
        </section>

        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-[13px] text-[#888888]">
            <svg className="animate-spin mr-2" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            正在读取会话内容…
          </div>
        ) : loadError ? (
          <div className="py-12 text-center">
            <p className="text-[13px] text-[#D32F2F]">{loadError}</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="py-12 text-center text-[13px] text-[#999999]">该会话暂无文本消息</div>
        ) : (
          <div>
            {searchResults.items.map(({ message, matches, firstMatchIndex }, index) => (
              <SessionMessage
                key={index}
                message={message}
                matches={matches}
                firstMatchIndex={firstMatchIndex}
                activeMatchIndex={activeMatchIndex >= firstMatchIndex && activeMatchIndex < firstMatchIndex + matches.length ? activeMatchIndex : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export default SessionDetailPanel;
