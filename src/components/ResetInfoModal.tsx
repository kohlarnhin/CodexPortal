import { useEffect, useState } from 'react';
import { Account, ResetCredit, ResetCreditsInfo } from '../types/account';
import Button from './ui/button';
import Input from './ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Check, CircleAlert, LoaderCircle } from 'lucide-react';

interface ResetInfoModalProps {
  account: Account;
  onClose: () => void;
  getResetCredits: (id: string, force?: boolean) => Promise<ResetCreditsInfo>;
  setAccountAccessToken: (id: string, accessToken: string) => Promise<void>;
  consumeResetCredit: (id: string, creditId: string) => Promise<ResetCreditsInfo>;
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

const STATUS_TONE: Record<string, string> = {
  available: 'success',
  redeemed: 'idle',
  expired: 'error',
};

export default function ResetInfoModal({
  account,
  onClose,
  getResetCredits,
  setAccountAccessToken,
  consumeResetCredit,
}: ResetInfoModalProps) {
  const [info, setInfo] = useState<ResetCreditsInfo | null>(null);
  const [needsAt, setNeedsAt] = useState(false);
  const [atReason, setAtReason] = useState<'missing' | 'expired'>('missing');
  const [atInput, setAtInput] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingAt, setIsSavingAt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmCredit, setConfirmCredit] = useState<ResetCredit | null>(null);
  const [consumingId, setConsumingId] = useState<string | null>(null);
  const [consumeError, setConsumeError] = useState<string | null>(null);
  const [consumeSuccess, setConsumeSuccess] = useState(false);

  const loadResetCredits = async (force = false) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await getResetCredits(account.id, force);
      setInfo(result);
      setNeedsAt(false);
    } catch (err: any) {
      const message = err?.toString() || '获取失败';
      if (message.includes('请重新输入 Access Token')) {
        setAtReason('expired');
        setNeedsAt(true);
      } else if (message.includes('未配置 Access Token')) {
        setAtReason('missing');
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

  const handleConsume = async (credit: ResetCredit) => {
    if (!credit.id) return;
    setConsumingId(credit.id);
    setConsumeError(null);
    setConsumeSuccess(false);
    try {
      const nextInfo = await consumeResetCredit(account.id, credit.id);
      setInfo(nextInfo);
      setConsumeSuccess(true);
      setConfirmCredit(null);
      window.setTimeout(() => setConsumeSuccess(false), 4000);
    } catch (err: any) {
      const message = err?.toString() || '使用重置卡失败';
      if (message.includes('请重新输入 Access Token')) {
        setConsumeError(null);
        setAtReason('expired');
        setNeedsAt(true);
      } else {
        setConsumeError(message);
      }
    } finally {
      setConsumingId(null);
    }
  };

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[82vh] max-w-lg flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-[var(--hairline-divider)] px-6 py-4 pr-14">
          <DialogTitle>重置卡</DialogTitle>
          <DialogDescription className="truncate">{account.name}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {needsAt ? (
            <div className="flex flex-col gap-4">
              <div
                className={`rounded-[10px] px-4 py-3 text-label leading-relaxed ${
                  atReason === 'expired'
                    ? 'bg-warning/12 text-warning'
                    : 'bg-muted/65 text-muted-foreground dark:bg-white/[0.04]'
                }`}
              >
                {atReason === 'expired'
                  ? 'Access Token 已失效，请粘贴该账号新的 Access Token 后重试。'
                  : 'Team 账号的重置卡需要通过 Access Token（at）获取，Personal Access Token 无法访问。请粘贴该账号的 Access Token 以获取重置卡信息。'}
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="atInput" className="text-label font-medium text-foreground">Access Token</label>
                <Input
                  type="text"
                  id="atInput"
                  value={atInput}
                  onChange={(e) => { setAtInput(e.target.value); setError(null); }}
                  placeholder="粘贴 Access Token…"
                  className="font-mono text-body"
                />
              </div>
              {error && (
                <div className="break-all rounded-[10px] bg-destructive/10 px-3 py-2 text-label text-destructive">
                  {error}
                </div>
              )}
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center gap-2.5 py-8 text-body text-muted-foreground">
              <LoaderCircle size={14} strokeWidth={2.5} className="animate-spin" />
              获取重置卡中…
            </div>
          ) : error ? (
            <div className="flex items-start gap-2.5 break-all rounded-[12px] bg-destructive/10 px-4 py-3 text-label leading-relaxed text-destructive">
              <CircleAlert size={14} className="mt-0.5 shrink-0" />
              <div>
                <p>{error}</p>
                <Button variant="destructive" size="sm" onClick={() => void loadResetCredits(true)} className="mt-2.5">
                  重新获取
                </Button>
              </div>
            </div>
          ) : info ? (
            <div className="flex flex-col gap-4">
              {consumeSuccess && (
                <div className="flex items-center gap-2 rounded-[10px] bg-success/12 px-3.5 py-2.5 text-label text-success">
                  <Check size={13} strokeWidth={2.5} className="shrink-0" />
                  重置成功！额度窗口已重置。
                </div>
              )}
              {consumeError && (
                <div className="flex items-start gap-2 break-all rounded-[10px] bg-destructive/10 px-3.5 py-2.5 text-label text-destructive">
                  <CircleAlert size={13} strokeWidth={2.5} className="mt-0.5 shrink-0" />
                  <span>{consumeError}</span>
                </div>
              )}

              <div className="bento-group flex items-center justify-between px-4 py-3">
                <span className="text-label text-muted-foreground">可用的重置次数</span>
                <span className="font-mono text-stat font-semibold leading-none text-foreground tabular-nums">
                  {info.availableCount}
                </span>
              </div>

              {info.credits.length > 0 ? (
                <div className="bento-group overflow-hidden">
                  {info.credits.map((credit, index) => {
                    const status = (credit.status || '').toLowerCase();
                    const isAvailable = status === 'available' && !!credit.id;
                    return (
                      <div key={index} className="border-t border-[var(--hairline-divider)] px-4 py-3 first:border-t-0">
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <span className="text-body font-medium text-foreground">
                            {credit.resetType || '重置'}
                          </span>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
                              <span
                                className="bento-status-dot"
                                data-tone={STATUS_TONE[status] || 'idle'}
                                aria-hidden="true"
                              />
                              {STATUS_LABELS[status] || credit.status || '未知'}
                            </span>
                            {isAvailable && (
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => {
                                  setConfirmCredit(credit);
                                  setConsumeError(null);
                                }}
                                disabled={consumingId !== null || confirmCredit !== null}
                                className="h-6 px-2.5 text-caption"
                              >
                                使用
                              </Button>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-caption text-[var(--label)] tabular-nums">
                          <span>到期：{formatTimestamp(credit.expiresAt)}</span>
                          <span>发放：{formatTimestamp(credit.grantedAt)}</span>
                          <span>兑换：{formatTimestamp(credit.redeemedAt)}</span>
                          {credit.id && <span className="truncate font-mono">#{credit.id}</span>}
                        </div>

                        {isAvailable && confirmCredit?.id === credit.id && (
                          <div className="mt-2.5 rounded-[10px] bg-warning/12 px-3 py-2.5">
                            <p className="mb-2 text-caption text-warning">
                              使用后立即重置当前额度窗口，确认使用这张重置卡？
                            </p>
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                onClick={() => void handleConsume(credit)}
                                disabled={consumingId !== null}
                                className="gap-1.5"
                              >
                                {consumingId === credit.id && (
                                  <LoaderCircle size={11} strokeWidth={2.5} className="animate-spin" />
                                )}
                                <span>{consumingId === credit.id ? '使用中…' : '确认使用'}</span>
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setConfirmCredit(null)}
                                disabled={consumingId !== null}
                              >
                                取消
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="bento-empty py-6 text-label text-[var(--label)]">
                  暂无重置卡记录
                </div>
              )}

              <div className="text-caption text-[var(--label)]">
                同步于 {info.syncedAt ? new Date(info.syncedAt).toLocaleString() : '—'}
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--hairline-divider)] px-6 py-3.5">
          {needsAt ? (
            <>
              <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={isSavingAt}>
                取消
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => void handleSaveAt()}
                disabled={isSavingAt}
                className="min-w-[96px]"
              >
                {isSavingAt ? '保存中…' : '保存并获取'}
              </Button>
            </>
          ) : (
            <>
              {!error && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void loadResetCredits(true)}
                  disabled={isLoading}
                >
                  重新获取
                </Button>
              )}
              <Button type="button" variant="default" size="sm" onClick={onClose}>
                关闭
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
