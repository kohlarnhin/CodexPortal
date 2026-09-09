import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Account, TestMessageResult } from '../types/account';
import { getDisplayedEmail } from '../utils/accountEmail';
import ToggleSwitch from './ToggleSwitch';
import Button from './ui/button';
import { Dialog, DialogContent } from './ui/dialog';

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
      window.alert(`自动激活设置保存失败，请手动处理：${String(saveError)}`);
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
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#EAEAEA] px-6 py-4.5 bg-white">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-black text-white shadow-sm">
              <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /></svg>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 id="quota-activation-title" className="text-[15px] font-semibold tracking-tight text-black">额度窗口激活</h3>
                <span className="inline-block px-2 py-0.5 rounded-full bg-[#F5F5F5] text-[11px] font-mono text-[#666666] truncate max-w-[200px]">
                  {getDisplayedEmail(account.name, isEmailMaskingEnabled)}
                </span>
              </div>
              <p className="mt-0.5 text-[12px] text-[#888888]">发送测试消息以刷新并激活该账号的额度窗口</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            aria-label="关闭额度窗口激活"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#999999] transition-colors hover:bg-[#F5F5F5] hover:text-black disabled:opacity-40"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </button>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* 自动激活开关卡片 */}
          <div className="flex items-start justify-between gap-4 rounded-xl border border-[#EAEAEA] bg-[#FAFAFA] p-4 transition-colors">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-black">自动刷新前激活额度窗口</div>
              <p className="mt-1 text-[12px] leading-relaxed text-[#777777]">
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
          <div className="rounded-xl border border-[#EAEAEA] bg-[#FAFAFA]/70 p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-medium text-[#666666] flex items-center gap-1.5">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
                激活配置
              </span>
              <div className="flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-white border border-[#E5E5E5] px-2 py-0.5 text-[11px] font-mono font-medium text-black shadow-2xs">
                  <span className="h-1.5 w-1.5 rounded-full bg-black/60" />
                  {result?.model || ACTIVATION_MODEL}
                </span>
                <span className="inline-flex items-center rounded-md bg-white border border-[#E5E5E5] px-1.5 py-0.5 text-[11px] text-[#666666] shadow-2xs">
                  思考: low
                </span>
              </div>
            </div>

            <div className="rounded-lg bg-white border border-[#EAEAEA] px-3.5 py-2.5">
              <div className="flex items-center justify-between text-[11px] text-[#999999] mb-1">
                <span className="flex items-center gap-1">
                  <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z" /></svg>
                  发送 Prompt
                </span>
              </div>
              <p className="font-mono text-[12.5px] text-[#333333] select-text">
                Introduce yourself.
              </p>
            </div>
          </div>

          {/* 响应结果区域 */}
          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50/70 p-3.5 text-[12px] text-red-700 flex items-start gap-2.5 animate-fade-in">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5 text-red-500"><circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="8" y2="12" /><line x1="12" x2="12.01" y1="16" y2="16" /></svg>
              <div className="min-w-0 flex-1 leading-relaxed break-words">{error}</div>
            </div>
          ) : isSending ? (
            <div className="rounded-xl border border-[#EAEAEA] bg-white p-4 shadow-2xs animate-fade-in">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-[12px] font-medium text-black">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <span>正在接收实时响应…</span>
                </div>
              </div>
              <div className="font-mono text-[12.5px] leading-relaxed text-[#333333] whitespace-pre-wrap break-words max-h-[140px] overflow-y-auto">
                {output || <span className="text-[#999999]">等待模型响应中…</span>}
                <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-black align-middle animate-pulse" />
              </div>
            </div>
          ) : result ? (
            <div className="rounded-xl border border-[#EAEAEA] bg-white p-4 shadow-2xs animate-fade-in">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#F0F0F0]">
                <div className="flex items-center gap-1.5 text-[12px] font-medium text-emerald-600">
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
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
                    className="text-[11px] text-[#888888] hover:text-black transition-colors"
                  >
                    {copied ? '✓ 已复制' : '复制回复'}
                  </button>
                )}
              </div>
              <div className="font-mono text-[12.5px] leading-relaxed text-[#333333] whitespace-pre-wrap break-words max-h-[140px] overflow-y-auto select-text pr-1">
                {output}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[#E0E0E0] bg-[#FAFAFA]/50 px-4 py-4 text-center">
              <p className="text-[12.5px] text-[#777777]">
                点击下方「立即激活」，将向该账号发送一条消息唤醒额度窗口并同步状态
              </p>
            </div>
          )}

          {/* 底部轻量提示条 */}
          <div className="flex items-center gap-2 rounded-lg bg-[#F8F8F8] border border-[#EFEFEF] px-3 py-2 text-[11px] text-[#888888]">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[#999999]"><circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="16" y2="12" /><line x1="12" x2="12.01" y1="8" y2="8" /></svg>
            <span>若激活失败将自动延后 5 分钟重试，并在重置后 1 分钟自动刷新</span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-end gap-2.5 border-t border-[#EAEAEA] bg-[#FAFAFA] px-6 py-3.5">
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
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
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

