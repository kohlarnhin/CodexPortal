import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Account, TestMessageResult } from '../types/account';
import { getDisplayedEmail } from '../utils/accountEmail';
import ToggleSwitch from './ToggleSwitch';
import Button from './ui/button';
import { Dialog, DialogContent } from './ui/dialog';
import { Check, CircleAlert, Info, LoaderCircle, MessageCircle, Settings, X, Zap } from 'lucide-react';
import { errorMessage, toast } from './ui/toast';

const ACTIVATION_MODEL = 'gpt-5.6-luna';

interface QuotaActivationModalProps {
  account: Account;
  onClose: () => void;
  isUsageRefreshing: boolean;
  isEmailMaskingEnabled: boolean;
}

export default function QuotaActivationModal({
  account,
  onClose,
  isUsageRefreshing,
  isEmailMaskingEnabled,
}: QuotaActivationModalProps) {
  const [autoActivateWindow, setAutoActivateWindow] = useState(account.autoActivateWindow);
  const [isSaving, setIsSaving] = useState(false);
  const [result, setResult] = useState<TestMessageResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [streamedText, setStreamedText] = useState('');
  const [copied, setCopied] = useState(false);
  const sending = useRef(false);
  const isBusy = isSending || isSaving;

  useEffect(() => {
    setAutoActivateWindow(account.autoActivateWindow);
  }, [account.autoActivateWindow]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<{ accountId: string; delta: string }>('test-output-delta', (event) => {
      if (!disposed && sending.current && event.payload.accountId === account.id) {
        setStreamedText((current) => current + event.payload.delta);
      }
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch((listenError) => {
      if (!disposed) setError(`无法显示实时回复：${String(listenError)}`);
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [account.id]);

  const saveAutoActivation = async (enabled: boolean) => {
    if (isBusy || isUsageRefreshing) return;
    setIsSaving(true);
    try {
      await invoke('set_auto_activate_window', { id: account.id, enabled });
      setAutoActivateWindow(enabled);
    } catch (saveError) {
      toast.error(errorMessage(saveError), { title: '自动激活设置保存失败，请手动处理' });
    } finally {
      setIsSaving(false);
    }
  };

  const activateWindow = async () => {
    if (sending.current || isSaving || isUsageRefreshing || !account.canRefreshUsage) return;
    sending.current = true;
    setIsSending(true);
    setResult(null);
    setError(null);
    setStreamedText('');
    try {
      const response = await invoke<TestMessageResult>('send_test_message', {
        id: account.id,
        model: ACTIVATION_MODEL,
      });
      setResult(response);
    } catch (sendError) {
      // 请求异常同时由全局弹窗展示，后端已安排下一次自动刷新。
      setError(String(sendError));
    } finally {
      sending.current = false;
      setIsSending(false);
    }
  };

  const output = result?.output || streamedText;

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open && !isBusy) onClose(); }}>
      <DialogContent
        className="max-w-lg p-0 max-h-[85vh] flex flex-col overflow-hidden gap-0"
        showCloseButton={false}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-6 py-4.5 bg-card">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-muted text-foreground">
              <Zap size={17} strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 id="quota-activation-title" className="text-title font-semibold tracking-tight text-foreground">额度窗口激活</h3>
                <span className="inline-block px-2 py-0.5 rounded-md bg-muted text-caption font-mono text-muted-foreground truncate max-w-[200px]">
                  {getDisplayedEmail(account.name, isEmailMaskingEnabled)}
                </span>
              </div>
              <p className="mt-0.5 text-label text-muted-foreground">发送测试消息以刷新并激活该账号的额度窗口</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            aria-label="关闭额度窗口激活"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* 自动激活开关卡片 */}
          <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/40 p-4 transition-colors">
            <div className="min-w-0">
              <div className="text-body font-semibold text-foreground">自动刷新前激活额度窗口</div>
              <p className="mt-1 text-label leading-relaxed text-muted-foreground">
                仅作用于当前账号。开启后，在自动刷新前主动发送一条消息唤醒窗口并获取额度（会消耗额度）。
              </p>
            </div>
            <div className="shrink-0 pt-0.5">
              <ToggleSwitch
                label="自动刷新前激活额度窗口"
                checked={autoActivateWindow}
                disabled={isBusy || isUsageRefreshing}
                onToggle={() => void saveAutoActivation(!autoActivateWindow)}
              />
            </div>
          </div>

          {/* 参数概览面板 */}
          <div className="rounded-lg border bg-muted/40 p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-label font-medium text-muted-foreground flex items-center gap-1.5">
                <Settings size={13} />
                激活配置
              </span>
              <div className="flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-card border border-border px-2 py-0.5 text-caption font-mono font-medium text-foreground shadow-xs">
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                  {result?.model || ACTIVATION_MODEL}
                </span>
                <span className="inline-flex items-center rounded-md bg-card border border-border px-1.5 py-0.5 text-caption text-muted-foreground shadow-xs">
                  思考: low
                </span>
              </div>
            </div>

            <div className="rounded-lg bg-card border px-3.5 py-2.5">
              <div className="flex items-center justify-between text-caption text-muted-foreground/70 mb-1">
                <span className="flex items-center gap-1">
                  <MessageCircle size={11} />
                  发送 Prompt
                </span>
              </div>
              <p className="font-mono text-body text-foreground select-text">
                Introduce yourself.
              </p>
            </div>
          </div>

          {/* 响应结果区域 */}
          {error ? (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3.5 text-label text-destructive flex items-start gap-2.5 animate-fade-in">
              <CircleAlert size={16} className="shrink-0 mt-0.5 text-destructive" />
              <div className="min-w-0 flex-1 leading-relaxed break-words">{error}</div>
            </div>
          ) : isSending ? (
            <div className="rounded-lg border bg-card p-4 animate-fade-in">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-label font-medium text-foreground">
                  <span className="relative flex h-2 w-2">
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
                  </span>
                  <span>正在接收实时响应…</span>
                </div>
              </div>
              <div className="font-mono text-body leading-relaxed text-foreground whitespace-pre-wrap break-words max-h-[140px] overflow-y-auto">
                {output || <span className="text-muted-foreground/70">等待模型响应中…</span>}
                <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-foreground align-middle animate-pulse" />
              </div>
            </div>
          ) : result ? (
            <div className="rounded-lg border bg-card p-4 animate-fade-in">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-border">
                <div className="flex items-center gap-1.5 text-label font-medium text-success">
                  <Check size={13} strokeWidth={2.5} />
                  <span>消息已成功发送 · 额度已更新</span>
                </div>
                {output && (
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(output);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                    className="text-caption text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {copied ? '✓ 已复制' : '复制回复'}
                  </button>
                )}
              </div>
              <div className="font-mono text-body leading-relaxed text-foreground whitespace-pre-wrap break-words max-h-[140px] overflow-y-auto select-text pr-1">
                {output}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-4 text-center">
              <p className="text-body text-muted-foreground">
                点击下方「立即激活」，将向该账号发送一条消息唤醒额度窗口并同步状态
              </p>
            </div>
          )}

          {/* 底部轻量提示条 */}
          <div className="flex items-center gap-2 rounded-lg bg-muted/50 border border-border px-3 py-2 text-caption text-muted-foreground">
            <Info size={12} className="shrink-0 text-muted-foreground/70" />
            <span>若激活失败将自动延后 5 分钟重试，并在重置后 1 分钟自动刷新</span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-end gap-2.5 border-t border-border bg-muted/50 px-6 py-3.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={isBusy}
          >
            关闭
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => void activateWindow()}
            disabled={isBusy || isUsageRefreshing || !account.canRefreshUsage}
            className="min-w-[96px]"
          >
            {isSending ? (
              <>
                <LoaderCircle size={13} strokeWidth={2.5} className="animate-spin" />
                <span>激活中…</span>
              </>
            ) : (
              <span>立即激活</span>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

