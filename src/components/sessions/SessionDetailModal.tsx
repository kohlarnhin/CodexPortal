import React, { useEffect, useState } from 'react';
import { SessionPreviewMessage, SessionRecord } from '../../types/session';
import { formatDateTime, formatFileSize, formatRelativeTime } from '../../utils/time';
import { formatTokens } from '../../utils/format';
import { parseSessionPreview } from '../../utils/sessionContent';

interface SessionDetailModalProps {
  session: SessionRecord;
  loadContent: (id: string) => Promise<string>;
  onCopyResume: (session: SessionRecord) => void;
  onRevealInFinder: (session: SessionRecord) => void;
  onClose: () => void;
}

const SessionDetailModal: React.FC<SessionDetailModalProps> = ({
  session,
  loadContent,
  onCopyResume,
  onRevealInFinder,
  onClose,
}) => {
  const [messages, setMessages] = useState<SessionPreviewMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/20 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-xl shadow-2xl border border-[#EAEAEA] w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden animate-modal-in">
        {/* 头部 */}
        <div className="px-6 py-4 border-b border-[#EAEAEA] shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="font-semibold text-[15px] text-black tracking-tight leading-snug line-clamp-2">
                {session.title}
              </h3>
              <p className="mt-1 text-[11px] font-mono text-[#888888] truncate">{session.filePath}</p>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 shrink-0 flex items-center justify-center rounded text-[#888888] hover:bg-[#F5F5F5] hover:text-black transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2 text-[11px] text-[#666666] flex-wrap">
            <span>开始 {formatDateTime(session.startedAt)}</span>
            <span className="text-[#D0D0D0]">·</span>
            <span>活跃 {formatRelativeTime(session.lastActivityAt)}</span>
            <span className="text-[#D0D0D0]">·</span>
            <span>{session.messageCount} 条消息</span>
            <span className="text-[#D0D0D0]">·</span>
            <span>{formatFileSize(session.fileSize)}</span>
            {session.model && (
              <>
                <span className="text-[#D0D0D0]">·</span>
                <span className="font-mono">{session.model}</span>
              </>
            )}
            {session.cliVersion && (
              <>
                <span className="text-[#D0D0D0]">·</span>
                <span className="font-mono">v{session.cliVersion}</span>
              </>
            )}
          </div>

          {/* Token 消耗明细 */}
          {session.totalTokens > 0 && (
            <div className="mt-2.5 flex items-center gap-2 text-[11px] text-[#666666] flex-wrap rounded-lg bg-[#FAFAFA] border border-[#EAEAEA] px-3 py-2">
              <span className="font-semibold text-black">Token 消耗</span>
              <span>
                输入 {formatTokens(session.inputTokens)}
                {session.cachedInputTokens > 0 && (
                  <span className="text-[#999999]">
                    {' '}（缓存命中 {formatTokens(session.cachedInputTokens)}）
                  </span>
                )}
              </span>
              <span className="text-[#D0D0D0]">·</span>
              <span>输出 {formatTokens(session.outputTokens)}</span>
              {session.reasoningTokens > 0 && (
                <>
                  <span className="text-[#D0D0D0]">·</span>
                  <span>推理 {formatTokens(session.reasoningTokens)}</span>
                </>
              )}
              <span className="text-[#D0D0D0]">·</span>
              <span className="font-bold text-black">合计 {formatTokens(session.totalTokens)}</span>
            </div>
          )}
        </div>

        {/* 内容预览 */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
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
            <div className="space-y-3">
              {messages.map((message, index) => (
                <div
                  key={index}
                  className={`rounded-lg border px-4 py-3 ${
                    message.role === 'user'
                      ? 'bg-[#F5F5F5] border-[#EAEAEA]'
                      : 'bg-white border-[#EAEAEA]'
                  }`}
                >
                  <p className={`text-[10px] font-bold uppercase tracking-wider mb-1.5 ${
                    message.role === 'user' ? 'text-black' : 'text-[#10B981]'
                  }`}>
                    {message.role === 'user' ? '用户' : 'Codex'}
                  </p>
                  <p className="text-[13px] text-[#444444] leading-relaxed whitespace-pre-wrap break-words">
                    {message.text}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 底部操作 */}
        <div className="px-6 py-3 bg-[#FAFAFA] border-t border-[#EAEAEA] flex items-center justify-between shrink-0">
          <span className="text-[11px] text-[#999999]">
            恢复命令：<code className="font-mono text-[#666666]">codex resume {session.id.slice(0, 8)}…</code>
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onRevealInFinder(session)}
              className="px-3 py-1.5 text-[13px] font-medium text-[#666666] hover:bg-[#F0F0F0] hover:text-black rounded-md transition-colors"
            >
              在 Finder 中显示
            </button>
            <button
              onClick={() => onCopyResume(session)}
              className="px-4 py-1.5 bg-black hover:bg-[#333333] text-white text-[13px] font-medium rounded-md transition-colors shadow-sm"
            >
              复制恢复命令
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SessionDetailModal;
