import { memo, useEffect, useId, useRef, useState } from 'react';
import type { SessionEntry } from '../../types/session';
import { formatDateTime } from '../../utils/time';
import type { TextMatch } from '../../utils/sessionSearch';
import HighlightedText from './HighlightedText';

interface SessionEntryViewProps {
  entry: SessionEntry;
  showRawRecord: boolean;
  matches: TextMatch[];
  matchSource: 'text' | 'raw';
  keyword: string;
  firstMatchIndex: number;
  activeMatchIndex?: number;
}

const SessionEntryView = memo(function SessionEntryView({
  entry, showRawRecord, matches, matchSource, keyword, firstMatchIndex, activeMatchIndex,
}: SessionEntryViewProps) {
  const [expanded, setExpanded] = useState(false);
  const [rawExpanded, setRawExpanded] = useState(false);
  const [dismissedMatch, setDismissedMatch] = useState<string | null>(null);
  const articleRef = useRef<HTMLElement>(null);
  const bodyId = useId();
  const rawId = useId();
  const matchKey = activeMatchIndex === undefined ? null : `${keyword}:${activeMatchIndex}:${matchSource}`;
  const revealMatch = matchKey !== null && matchKey !== dismissedMatch;
  const isExpanded = !entry.defaultCollapsed || expanded || revealMatch;
  const showRaw = showRawRecord && isExpanded && (rawExpanded || (revealMatch && matchSource === 'raw'));

  useEffect(() => {
    setDismissedMatch(null);
  }, [matchKey]);

  useEffect(() => {
    if (!revealMatch || !isExpanded) return;
    const frame = requestAnimationFrame(() => {
      articleRef.current
        ?.querySelector<HTMLElement>(`[data-search-match="${activeMatchIndex}"]`)
        ?.scrollIntoView({ block: 'center' });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeMatchIndex, keyword, matches, revealMatch, isExpanded, showRaw]);

  const timestamp = entry.timestamp && (
    <time dateTime={entry.timestamp} title={entry.timestamp} className="shrink-0 text-[10px] font-normal tabular-nums text-[#999999]">
      {formatDateTime(entry.timestamp)}
    </time>
  );

  return (
    <article
      ref={articleRef}
      className={`min-w-0 border-b border-[#EAEAEA] last:border-b-0 ${entry.defaultCollapsed ? 'py-2' : 'py-5'}`}
      style={revealMatch ? undefined : { contentVisibility: 'auto', containIntrinsicSize: 'auto 64px' }}
    >
      {entry.defaultCollapsed ? (
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-controls={bodyId}
          onClick={() => {
            setExpanded(!isExpanded);
            setDismissedMatch(isExpanded ? matchKey : null);
          }}
          className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-[11px] text-[#777777] hover:bg-black/[0.03] hover:text-black focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-black/30"
        >
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}><path d="m9 5 7 7-7 7" /></svg>
          <span className="min-w-0 flex-1 truncate font-medium" title={entry.title}>{entry.title}</span>
          {matches.length > 0 && <span className="shrink-0 text-[10px] text-black">{matches.length} 处匹配</span>}
          {timestamp}
          <span className="shrink-0 text-[10px] text-[#999999]">{isExpanded ? '收起' : '展开'}</span>
        </button>
      ) : (
        <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
          <p className={`text-[11px] font-semibold ${entry.role === 'user' ? 'text-black' : 'text-[#777777]'}`}>{entry.title}</p>
          {timestamp}
        </div>
      )}

      {isExpanded && (
        <div id={bodyId} className={entry.defaultCollapsed ? 'px-2 pb-2 pt-1' : undefined}>
          <div className={entry.defaultCollapsed
            ? 'overflow-x-auto rounded-md border border-[#EAEAEA] bg-white px-3 py-2.5 font-mono text-[12px] leading-relaxed text-[#555555] whitespace-pre-wrap break-words'
            : 'text-[13px] text-[#444444] leading-relaxed whitespace-pre-wrap break-words'}>
            <HighlightedText
              text={entry.text}
              matches={matchSource === 'text' ? matches : []}
              firstMatchIndex={firstMatchIndex}
              activeMatchIndex={activeMatchIndex}
            />
          </div>
          {showRawRecord && (
            <button
              type="button"
              aria-expanded={showRaw}
              aria-controls={rawId}
              onClick={() => {
                setRawExpanded(!showRaw);
                if (showRaw && matchSource === 'raw') {
                  setExpanded(true);
                  setDismissedMatch(matchKey);
                }
              }}
              className="mt-2 rounded px-1 py-0.5 text-[10px] text-[#999999] hover:bg-black/[0.03] hover:text-black focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-black/30"
            >
              {showRaw ? '收起原始记录' : '查看完整原始记录'}
            </button>
          )}
          {showRaw && (
            <pre id={rawId} className="mt-2 overflow-x-auto rounded-md border border-[#EAEAEA] bg-white p-3 font-mono text-[11px] leading-relaxed text-[#777777] whitespace-pre-wrap break-all">
              <HighlightedText
                text={entry.raw}
                matches={matchSource === 'raw' ? matches : []}
                firstMatchIndex={firstMatchIndex}
                activeMatchIndex={activeMatchIndex}
              />
            </pre>
          )}
        </div>
      )}
    </article>
  );
});

export default SessionEntryView;
