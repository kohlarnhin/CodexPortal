import React, { useEffect, useState } from 'react';
import { Account, ResetCreditsInfo } from '../types/account';

interface ResetInfoModalProps {
  account: Account;
  onClose: () => void;
  getResetCredits: (id: string, force?: boolean) => Promise<ResetCreditsInfo>;
  setAccountAccessToken: (id: string, accessToken: string) => Promise<void>;
}

function formatTimestamp(value: number | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

const STATUS_LABELS: Record<string, string> = {
  available: '可用',
  redeemed: '已兑换',
  expired: '已过期',
};

const STATUS_COLORS: Record<string, string> = {
  available: 'bg-emerald-50 text-emerald-600 border-emerald-200',
  redeemed: 'bg-[#F5F5F5] text-[#888888] border-[#EAEAEA]',
  expired: 'bg-[#FFF0F0] text-[#D32F2F] border-[#FFD0D0]',
};

export default function ResetInfoModal({
  account,
  onClose,
  getResetCredits,
  setAccountAccessToken,
}: ResetInfoModalProps) {
  const [info, setInfo] = useState<ResetCreditsInfo | null>(null);
  const [needsAt, setNeedsAt] = useState(false);
  const [atInput, setAtInput] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingAt, setIsSavingAt] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadResetCredits = async (force = false) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await getResetCredits(account.id, force);
      setInfo(result);
      setNeedsAt(false);
    } catch (err: any) {
      const message = err?.toString() || '获取失败';
      if (message.includes('未配置 Access Token')) {
        setNeedsAt(true);
      } else {
        setError(message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadResetCredits(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id]);

  const handleSaveAt = async () => {
    if (!atInput.trim()) {
      setError('请输入 Access Token');
      return;
    }
    setIsSavingAt(true);
    setError(null);
    try {
      await setAccountAccessToken(account.id, atInput.trim());
      await loadResetCredits(true);
    } catch (err: any) {
      setError(err?.toString() || '保存失败');
    } finally {
      setIsSavingAt(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm animate-fade-in" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-modal-title"
        className="relative bg-white rounded-xl shadow-2xl border border-[#EAEAEA] w-full max-w-lg overflow-hidden animate-modal-in flex flex-col max-h-[82vh]"
      >
        <div className="px-5 py-4 border-b border-[#EAEAEA] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 shrink-0 rounded-lg bg-black text-white flex items-center justify-center shadow-sm">
              <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            </div>
            <div className="min-w-0">
              <h3 id="reset-modal-title" className="font-semibold text-[15px] text-black tracking-tight">重置卡</h3>
              <p className="truncate text-[12px] text-[#888888] mt-0.5">{account.name}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="w-7 h-7 flex items-center justify-center rounded text-[#999999] hover:bg-[#F5F5F5] hover:text-black transition-colors shrink-0"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5">
          {needsAt ? (
            <div className="flex flex-col gap-4">
              <div className="rounded-lg border border-[#EAEAEA] bg-[#F9F9F9] px-4 py-3 text-[12px] text-[#666666] leading-relaxed">
                Team 账号的重置卡需要通过 Access Token（at）获取，Personal Access Token 无法访问。
                请粘贴该账号的 Access Token 以获取重置卡信息。
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="atInput" className="text-[12px] font-medium text-black">Access Token</label>
                <input
                  type="text"
                  id="atInput"
                  value={atInput}
                  onChange={(e) => { setAtInput(e.target.value); setError(null); }}
                  placeholder="粘贴 Access Token..."
                  className="w-full px-3 py-2 bg-white border border-[#EAEAEA] rounded-md focus:border-black focus:ring-1 focus:ring-black outline-none transition-all text-black placeholder-[#A0A0A0] text-[13px] font-mono"
                />
              </div>
              {error && (
                <div className="flex items-start gap-2 break-all rounded-md bg-[#FFF0F0] border border-[#FFD0D0] px-3 py-2 text-[12px] text-[#D32F2F]">
                  <span>{error}</span>
                </div>
              )}
            </div>
          ) : isLoading ? (
            <div className="flex items-center gap-2.5 py-8 justify-center text-[13px] text-[#666666]">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
              获取重置卡中...
            </div>
          ) : error ? (
            <div className="flex items-start gap-2 break-all rounded-md bg-[#FFF0F0] border border-[#FFD0D0] px-3.5 py-3 text-[12px] text-[#D32F2F] leading-relaxed">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
              <div>
                <p>{error}</p>
                <button
                  onClick={() => void loadResetCredits(true)}
                  className="mt-2 px-3 py-1 bg-[#D32F2F] hover:bg-[#B71C1C] text-white text-[12px] font-medium rounded-md transition-colors"
                >
                  重新获取
                </button>
              </div>
            </div>
          ) : info ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between rounded-lg border border-[#EAEAEA] bg-[#FAFAFA] px-4 py-3">
                <span className="text-[12px] text-[#888888]">可用的重置次数</span>
                <span className="text-[22px] font-bold font-mono text-black leading-none">{info.availableCount}</span>
              </div>

              {info.credits.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {info.credits.map((credit, index) => {
                    const status = (credit.status || '').toLowerCase();
                    return (
                      <div key={index} className="rounded-lg border border-[#EAEAEA] px-3.5 py-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[13px] font-medium text-black">
                            {credit.resetType || '重置'}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full border text-[11px] font-medium ${STATUS_COLORS[status] || STATUS_COLORS.redeemed}`}>
                            {STATUS_LABELS[status] || credit.status || '未知'}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-[#888888]">
                          <span>到期：{formatTimestamp(credit.expiresAt)}</span>
                          <span>发放：{formatTimestamp(credit.grantedAt)}</span>
                          <span>兑换：{formatTimestamp(credit.redeemedAt)}</span>
                          {credit.id && <span className="truncate font-mono">#{credit.id}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-[#DADADA] bg-[#FAFAFA] px-4 py-6 text-center text-[12px] text-[#999999]">
                  暂无重置卡记录
                </div>
              )}

              <div className="text-[11px] text-[#999999]">
                同步于 {info.syncedAt ? new Date(info.syncedAt).toLocaleString() : '—'}
              </div>
            </div>
          ) : null}
        </div>

        <div className="px-5 py-3 bg-[#FAFAFA] border-t border-[#EAEAEA] flex items-center justify-end gap-2 shrink-0">
          {needsAt ? (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={isSavingAt}
                className="px-4 py-1.5 text-[13px] font-medium text-[#666666] hover:bg-[#F0F0F0] hover:text-black rounded-md transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleSaveAt()}
                disabled={isSavingAt}
                className="min-w-[96px] px-4 py-1.5 bg-black hover:bg-[#333333] text-white text-[13px] font-medium rounded-md transition-colors shadow-sm disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {isSavingAt ? '保存中...' : '保存并获取'}
              </button>
            </>
          ) : (
            <>
              {!error && (
                <button
                  type="button"
                  onClick={() => void loadResetCredits(true)}
                  disabled={isLoading}
                  className="px-4 py-1.5 text-[13px] font-medium text-[#666666] hover:bg-[#F0F0F0] hover:text-black rounded-md transition-colors disabled:opacity-50"
                >
                  重新获取
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1.5 bg-black hover:bg-[#333333] text-white text-[13px] font-medium rounded-md transition-colors shadow-sm"
              >
                关闭
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
