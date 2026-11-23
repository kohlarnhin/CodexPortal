import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Account, TestMessageResult } from '../types/account';
import { getDisplayedEmail } from '../utils/accountEmail';
import { isApiKeyAccount } from '../utils/accountAuth';
import Button from './ui/button';
import Input from './ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Check, CircleAlert, Info, LoaderCircle, MessageCircle, Settings } from 'lucide-react';

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
  const isApiKey = isApiKeyAccount(account);
  const canSendTest = isApiKey ? account.canActivate : account.canRefreshUsage;
  const [apiModel, setApiModel] = useState(ACTIVATION_MODEL);
  const [result, setResult] = useState<TestMessageResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [streamedText, setStreamedText] = useState('');
  const [copied, setCopied] = useState(false);
  const sending = useRef(false);
  const isBusy = isSending;

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

  const activateWindow = async () => {
    if (sending.current || isUsageRefreshing || !canSendTest || (isApiKey && !apiModel.trim())) return;
    sending.current = true;
    setIsSending(true);
    setResult(null);
    setError(null);
    setStreamedText('');
    try {
      const response = await invoke<TestMessageResult>('send_test_message', {
        id: account.id,
        model: isApiKey ? apiModel.trim() : ACTIVATION_MODEL,
      });
      setResult(response);
    } catch (sendError) {
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
        className="flex max-h-[85vh] max-w-lg flex-col gap-0 overflow-hidden p-0"
        showCloseButton={!isBusy}
      >
        <DialogHeader className="shrink-0 border-b border-[var(--hairline-divider)] px-6 py-4 pr-14">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>{isApiKey ? '测试 API Key' : '额度窗口激活'}</DialogTitle>
            <span className="max-w-[200px] truncate rounded-full bg-[var(--button-fill)] px-2.5 py-0.5 font-mono text-caption text-muted-foreground">
              {getDisplayedEmail(account.name, isEmailMaskingEnabled)}
            </span>
          </div>
          <DialogDescription>
            {isApiKey ? '向 OpenAI 官方 API 发送一条测试消息' : '发送测试消息以刷新并激活该账号的额度窗口'}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div className="bento-group space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-label font-medium text-[var(--label)]">
                <Settings size={13} />
                {isApiKey ? '测试配置' : '激活配置'}
              </span>
              <div className="flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--button-fill)] px-2.5 py-0.5 font-mono text-caption font-medium text-foreground">
                  {result?.model || (isApiKey ? apiModel : ACTIVATION_MODEL)}
                </span>
                {!isApiKey && (
                  <span className="inline-flex items-center rounded-full bg-[var(--button-fill)] px-2 py-0.5 text-caption text-muted-foreground">
                    思考: low
                  </span>
                )}
              </div>
            </div>

            {isApiKey && (
              <div>
                <label htmlFor="apiTestModel" className="mb-1.5 block text-label font-medium text-foreground">模型</label>
                <Input
                  id="apiTestModel"
                  value={apiModel}
                  onChange={(event) => setApiModel(event.target.value)}
                  disabled={isBusy}
                  placeholder="输入此 Key 可用的模型名称"
                  className="font-mono text-label"
                />
              </div>
            )}

            <div className="rounded-[10px] bg-muted/65 px-3.5 py-2.5 dark:bg-white/[0.04]">
              <div className="mb-1 flex items-center gap-1 text-caption text-[var(--label)]">
                <MessageCircle size={11} />
                发送 Prompt
              </div>
              <p className="font-mono text-body text-foreground select-text">Introduce yourself.</p>
            </div>
          </div>

          {error ? (
            <div className="animate-fade-in flex items-start gap-2.5 rounded-[12px] bg-destructive/10 p-3.5 text-label text-destructive">
              <CircleAlert size={15} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1 leading-relaxed break-words">{error}</div>
            </div>
          ) : isSending ? (
            <div className="bento-console animate-fade-in p-4">
              <div className="mb-2 flex items-center gap-2 text-label font-medium text-[#f0f0f2]">
                <span className="bento-status-dot" data-tone="running" aria-hidden="true" />
                <span>正在接收实时响应…</span>
              </div>
              <div className="max-h-[140px] overflow-y-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-[#d1d1d6]">
                {output || <span className="text-[#8e8e93]">等待模型响应中…</span>}
                <span className="ml-0.5 inline-block h-3.5 w-1.5 align-middle bg-[#f0f0f2] animate-pulse" />
              </div>
            </div>
          ) : result ? (
            <div className="bento-console animate-fade-in p-4">
              <div className="mb-2 flex items-center justify-between border-b border-white/[0.08] pb-2">
                <div className="flex items-center gap-1.5 text-label font-medium text-[#30d158]">
                  <Check size={13} strokeWidth={2.5} />
                  <span>{isApiKey ? 'API 测试成功 · 消息已发送' : '消息已成功发送 · 额度已更新'}</span>
                </div>
                {output && (
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(output);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                    className="cursor-pointer text-caption text-[#a1a1a6] transition-colors hover:text-white"
                  >
                    {copied ? '✓ 已复制' : '复制回复'}
                  </button>
                )}
              </div>
              <div className="max-h-[140px] overflow-y-auto whitespace-pre-wrap break-words pr-1 font-mono text-[12px] leading-relaxed text-[#d1d1d6] select-text">
                {output}
              </div>
            </div>
          ) : (
            <div className="bento-empty py-5">
              <p className="text-body text-muted-foreground">
                {isApiKey ? '选择可用模型后，点击「发送测试」查看回复' : '点击下方「立即激活」，将向该账号发送一条消息唤醒额度窗口并同步状态'}
              </p>
            </div>
          )}

          <div className="flex items-center gap-2 rounded-[10px] bg-muted/65 px-3 py-2 text-caption text-muted-foreground dark:bg-white/[0.04]">
            <Info size={12} className="shrink-0 text-[var(--label)]" />
            <span>
              {isApiKey
                ? '测试消息会消耗 API 额度，按 OpenAI 官方价格计费'
                : '若激活失败将自动延后 5 分钟重试，并在重置后 1 分钟自动刷新'}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--hairline-divider)] px-6 py-3.5">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={isBusy}>
            关闭
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => void activateWindow()}
            disabled={isBusy || isUsageRefreshing || !canSendTest || (isApiKey && !apiModel.trim())}
            className="min-w-[96px]"
          >
            {isSending ? (
              <>
                <LoaderCircle size={13} strokeWidth={2.5} className="animate-spin" />
                <span>{isApiKey ? '测试中…' : '激活中…'}</span>
              </>
            ) : (
              <span>{isApiKey ? '发送测试' : '立即激活'}</span>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
