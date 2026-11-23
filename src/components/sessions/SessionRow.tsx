import React from 'react';
import { SessionRecord } from '../../types/session';
import { formatDateTime, formatFileSize, formatRelativeTime } from '../../utils/time';
import { formatTokens } from '../../utils/format';
import { findTextMatches } from '../../utils/sessionSearch';
import HighlightedText from './HighlightedText';
import SessionCopyMenu from './SessionCopyMenu';
import { Eye, Folder } from 'lucide-react';

interface SessionRowProps {
  session: SessionRecord;
  search?: string;
  showProject?: boolean;
  onOpenDetail: (session: SessionRecord) => void;
  onRevealInFinder: (session: SessionRecord) => void;
}

const SessionRow: React.FC<SessionRowProps> = ({
  session,
  search = '',
  showProject = false,
  onOpenDetail,
  onRevealInFinder,
}) => {
  return (
    <div
      data-no-press
      onClick={() => onOpenDetail(session)}
      role="button"
      tabIndex={0}
      onKeyDown={event => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onOpenDetail(session);
        }
      }}
      className="bento-card group flex min-h-[104px] min-w-0 cursor-pointer flex-col items-start justify-between gap-3.5 px-5 py-4.5 transition-colors hover:bg-[var(--hover)] @min-[700px]/page:flex-row"
    >
      <div className="w-full min-w-0 flex-1">
        <p className="line-clamp-2 break-words text-[14.5px] font-semibold leading-snug tracking-[-0.01em] text-foreground">
          {session.title}
        </p>
        <p className="mt-1.5 break-all font-mono text-caption text-[var(--label)]">
          ID: <HighlightedText text={session.id} matches={findTextMatches(session.id, search)} />
        </p>
        {showProject && (
          <p className="mt-1 truncate text-label text-muted-foreground" title={session.projectPath}>
            项目：{session.projectPath || '未知项目'}
          </p>
        )}
        <div className="mt-2.5 flex flex-wrap items-center gap-2 text-label text-muted-foreground tabular-nums">
          <span>开始于 {formatDateTime(session.startedAt)}</span>
          {session.lastActivityAt && (
            <>
              <span className="text-[var(--label)]">·</span>
              <span>最近活跃 {formatRelativeTime(session.lastActivityAt)}</span>
            </>
          )}
          <span className="text-[var(--label)]">·</span>
          <span>{session.messageCount} 条消息</span>
          <span className="text-[var(--label)]">·</span>
          <span>{formatFileSize(session.fileSize)}</span>
          {session.totalTokens > 0 && (
            <>
              <span className="text-[var(--label)]">·</span>
              <span>{formatTokens(session.totalTokens)} tokens</span>
            </>
          )}
        </div>
      </div>

      <div className="flex max-w-full shrink-0 flex-wrap items-center gap-1.5 pt-0.5">
        {session.isSubagent && (
          <span className="rounded-full bg-[var(--button-fill)] px-2.5 py-0.5 text-caption font-medium text-muted-foreground">
            子会话
          </span>
        )}
        {session.model && (
          <span
            className="max-w-44 truncate rounded-full bg-[var(--button-fill)] px-2.5 py-0.5 font-mono text-caption text-muted-foreground"
            title={session.modelProvider || undefined}
          >
            {session.model}
          </span>
        )}
        {session.cliVersion && (
          <span className="rounded-full bg-[var(--button-fill)] px-2.5 py-0.5 font-mono text-caption text-muted-foreground">
            v{session.cliVersion}
          </span>
        )}

        <SessionCopyMenu session={session} />
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              onOpenDetail(session);
            }}
            title="查看会话内容"
            aria-label="查看会话内容"
            className="grid size-7 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-foreground"
          >
            <Eye size={14} />
          </button>
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              onRevealInFinder(session);
            }}
            title="在 Finder 中显示"
            aria-label="在 Finder 中显示"
            className="grid size-7 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-foreground"
          >
            <Folder size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default SessionRow;
