import React from 'react';
import { SessionRecord } from '../../types/session';
import { formatDateTime, formatFileSize, formatRelativeTime } from '../../utils/time';
import { formatTokens } from '../../utils/format';
import { findTextMatches } from '../../utils/sessionSearch';
import HighlightedText from './HighlightedText';
import SessionCopyMenu from './SessionCopyMenu';

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
      onClick={() => onOpenDetail(session)}
      role="button"
      tabIndex={0}
      onKeyDown={event => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onOpenDetail(session);
        }
      }}
      className="group min-w-0 bg-card rounded-xl border shadow-xs hover:bg-accent/40 transition-colors p-4 flex flex-col @min-[720px]/page:flex-row items-start gap-4 cursor-pointer"
    >
      <div className="flex-1 min-w-0 w-full">
        <p className="break-words text-[14px] font-medium text-foreground leading-snug line-clamp-2">{session.title}</p>
        <p className="mt-1.5 break-all text-[11px] font-mono text-muted-foreground">
          ID: <HighlightedText text={session.id} matches={findTextMatches(session.id, search)} />
        </p>
        {showProject && (
          <p className="mt-1 text-[11px] text-muted-foreground truncate" title={session.projectPath}>
            项目：{session.projectPath || '未知项目'}
          </p>
        )}
        <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
          <span>开始于 {formatDateTime(session.startedAt)}</span>
          {session.lastActivityAt && (
            <>
              <span className="text-neutral-300">·</span>
              <span>最近活跃 {formatRelativeTime(session.lastActivityAt)}</span>
            </>
          )}
          <span className="text-neutral-300">·</span>
          <span>{session.messageCount} 条消息</span>
          <span className="text-neutral-300">·</span>
          <span>{formatFileSize(session.fileSize)}</span>
          {session.totalTokens > 0 && (
            <>
              <span className="text-neutral-300">·</span>
              <span>{formatTokens(session.totalTokens)} tokens</span>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 shrink-0 max-w-full">
        {session.isSubagent && (
          <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-[10.5px] text-muted-foreground">
            子会话
          </span>
        )}
        {session.model && (
          <span
            className="max-w-48 truncate rounded-md bg-muted border border-border px-2 py-0.5 text-[10.5px] font-mono text-muted-foreground"
            title={session.modelProvider || undefined}
          >
            {session.model}
          </span>
        )}
        {session.cliVersion && (
          <span className="rounded-md bg-muted border border-border px-2 py-0.5 text-[10.5px] font-mono text-muted-foreground">
            v{session.cliVersion}
          </span>
        )}

        <SessionCopyMenu session={session} />
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          <button
            onClick={e => {
              e.stopPropagation();
              onOpenDetail(session);
            }}
            title="查看会话内容"
            className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
          <button
            onClick={e => {
              e.stopPropagation();
              onRevealInFinder(session);
            }}
            title="在 Finder 中显示"
            className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default SessionRow;
