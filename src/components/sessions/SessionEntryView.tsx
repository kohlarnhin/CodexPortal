import { memo, useEffect, useId, useRef, useState } from 'react';
import type { SessionEntry } from '../../types/session';
import { formatDateTime } from '../../utils/time';
import type { TextMatch } from '../../utils/sessionSearch';
import HighlightedText from './HighlightedText';
import { ChevronRight } from 'lucide-react';

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
    <time dateTime={entry.timestamp} title={entry.timestamp} className="shrink-0 text-caption font-normal text-[var(--label)] tabular-nums">
      {formatDateTime(entry.timestamp)}
    </time>
  );

  return (
    <article
      ref={articleRef}
      className={`min-w-0 border-b border-[var(--hairline-divider)] last:border-b-0 ${entry.defaultCollapsed ? 'py-2' : 'py-5'}`}
      style={revealMatch ? undefined : { contentVisibility: 'auto', containIntrinsicSize: 'auto 64px' }}
    >
      {entry.defaultCollapsed ? (
        <button
          type="button"
          data-no-press
          aria-expanded={isExpanded}
          aria-controls={bodyId}
          onClick={() => {
            setExpanded(!isExpanded);
            setDismissedMatch(isExpanded ? matchKey : null);
          }}
          className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-[8px] px-2.5 py-2 text-left text-caption text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-foreground"
        >
          <ChevronRight aria-hidden="true" size={12} className={`shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
          <span className="min-w-0 flex-1 truncate font-medium" title={entry.title}>{entry.title}</span>
          {matches.length > 0 && <span className="shrink-0 font-medium text-foreground">{matches.length} 处匹配</span>}
          {timestamp}
          <span className="shrink-0 text-[var(--label)]">{isExpanded ? '收起' : '展开'}</span>
        </button>
      ) : (
        <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
          <p className={`text-caption font-semibold ${entry.role === 'user' ? 'text-foreground' : 'text-[var(--label)]'}`}>
            {entry.title}
          </p>
          {timestamp}
        </div>
      )}

      {isExpanded && (
        <div id={bodyId} className={entry.defaultCollapsed ? 'px-2 pb-2 pt-1' : undefined}>
          <div
            className={
              entry.defaultCollapsed
                ? 'overflow-x-auto rounded-[10px] bg-muted/65 px-3.5 py-2.5 font-mono text-label leading-relaxed text-muted-foreground whitespace-pre-wrap break-words select-text dark:bg-white/[0.04]'
                : 'text-body leading-relaxed text-foreground/90 whitespace-pre-wrap break-words select-text'
            }
          >
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
              className="bento-tag mt-2 text-[var(--label)] hover:text-foreground"
            >
              {showRaw ? '收起原始记录' : '查看完整原始记录'}
            </button>
          )}
          {showRaw && (
            <pre
              id={rawId}
              className="mt-2 overflow-x-auto rounded-[10px] border border-[var(--console-border)] bg-[var(--console-surface)] p-3 font-mono text-caption leading-relaxed text-[var(--console-foreground)] whitespace-pre-wrap break-all select-text"
            >
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
