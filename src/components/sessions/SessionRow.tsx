import React, { useState } from 'react';
import { SessionRecord } from '../../types/session';
import { formatDateTime, formatFileSize, formatRelativeTime } from '../../utils/time';
import { formatTokens } from '../../utils/format';

interface SessionRowProps {
  session: SessionRecord;
  onOpenDetail: (session: SessionRecord) => void;
  onCopyResume: (session: SessionRecord) => void;
  onRevealInFinder: (session: SessionRecord) => void;
}

const SessionRow: React.FC<SessionRowProps> = ({
  session,
  onOpenDetail,
  onCopyResume,
  onRevealInFinder,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    onCopyResume(session);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      onClick={() => onOpenDetail(session)}
      className="group bg-white rounded-xl border border-[#EAEAEA] hover:border-[#C8C8C8] transition-colors p-4 flex items-start gap-4 cursor-pointer"
    >
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-medium text-black leading-snug line-clamp-2">{session.title}</p>
        <div className="mt-2 flex items-center gap-2 text-[11px] text-[#888888] flex-wrap">
          <span>开始于 {formatDateTime(session.startedAt)}</span>
          {session.lastActivityAt && (
            <>
              <span className="text-[#D0D0D0]">·</span>
              <span>最近活跃 {formatRelativeTime(session.lastActivityAt)}</span>
            </>
          )}
          <span className="text-[#D0D0D0]">·</span>
          <span>{session.messageCount} 条消息</span>
          <span className="text-[#D0D0D0]">·</span>
          <span>{formatFileSize(session.fileSize)}</span>
          {session.totalTokens > 0 && (
            <>
              <span className="text-[#D0D0D0]">·</span>
              <span>{formatTokens(session.totalTokens)} tokens</span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {session.model && (
          <span
            className="rounded-full bg-[#F5F5F5] border border-[#EAEAEA] px-2 py-0.5 text-[10px] font-mono text-[#666666]"
            title={session.modelProvider || undefined}
          >
            {session.model}
          </span>
        )}
        {session.cliVersion && (
          <span className="rounded-full bg-[#F5F5F5] border border-[#EAEAEA] px-2 py-0.5 text-[10px] font-mono text-[#888888]">
            v{session.cliVersion}
          </span>
        )}

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={handleCopy}
            title={copied ? '已复制' : '复制恢复命令'}
            className="w-7 h-7 flex items-center justify-center rounded text-[#888888] hover:bg-[#F5F5F5] hover:text-black transition-colors"
          >
            {copied ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            )}
          </button>
          <button
            onClick={e => {
              e.stopPropagation();
              onOpenDetail(session);
            }}
            title="查看会话内容"
            className="w-7 h-7 flex items-center justify-center rounded text-[#888888] hover:bg-[#F5F5F5] hover:text-black transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
          <button
            onClick={e => {
              e.stopPropagation();
              onRevealInFinder(session);
            }}
            title="在 Finder 中显示"
            className="w-7 h-7 flex items-center justify-center rounded text-[#888888] hover:bg-[#F5F5F5] hover:text-black transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default SessionRow;
