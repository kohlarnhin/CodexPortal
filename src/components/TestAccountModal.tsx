import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Account, AccountUsage, TestMessageResult } from '../types/account';
import { useConfig } from '../hooks/useConfig';

interface TestAccountModalProps {
  account: Account;
  onClose: () => void;
  onRefreshUsage: (accountId: string) => Promise<AccountUsage>;
}

export default function TestAccountModal({
  account,
  onClose,
  onRefreshUsage,
}: TestAccountModalProps) {
  const { config, isLoading: isConfigLoading, error: configError } = useConfig();
  const [result, setResult] = useState<TestMessageResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [streamedText, setStreamedText] = useState('');

  const model = config?.model?.trim() || '';
  const canSend = !isConfigLoading && !configError && !!model && !isSending;

  // 监听后端流式推送的文本增量，实时追加显示
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      unlisten = await listen<{ accountId: string; delta: string }>('test-output-delta', (event) => {
        if (disposed) return;
        const { accountId, delta } = event.payload;
        if (accountId !== account.id) return;
        setStreamedText((current) => current + delta);
      });
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [account.id]);

  const handleSend = async () => {
    if (isSending) return;
    if (!model) {
      setResult(null);
      setError('未配置模型，请先在“配置管理”中设置 model。');
      return;
    }
    setIsSending(true);
    setResult(null);
    setError(null);
    setStreamedText('');
    try {
      const response = await invoke<TestMessageResult>('send_test_message', {
        id: account.id,
        model,
      });
      setResult(response);
      // 测试成功即消耗了额度，自动刷新额度
      onRefreshUsage(account.id).catch(() => undefined);
    } catch (sendError: any) {
      setError(sendError?.toString() || '额度测试失败');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm animate-fade-in" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="test-modal-title"
        className="relative bg-white rounded-xl shadow-2xl border border-[#EAEAEA] w-full max-w-lg overflow-hidden animate-modal-in flex flex-col max-h-[82vh]"
      >
        <div className="px-5 py-4 border-b border-[#EAEAEA] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 shrink-0 rounded-lg bg-black text-white flex items-center justify-center shadow-sm">
              <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            </div>
            <div className="min-w-0">
              <h3 id="test-modal-title" className="font-semibold text-[15px] text-black tracking-tight">额度测试</h3>
              <p className="truncate text-[12px] text-[#888888] mt-0.5">{account.name}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="关闭测试窗口"
            className="w-7 h-7 flex items-center justify-center rounded text-[#999999] hover:bg-[#F5F5F5] hover:text-black transition-colors shrink-0"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-[12px] font-medium text-[#888888]">模型</span>
              <span className="min-w-0 flex-1 font-mono text-[13px] font-medium text-black break-all select-text">
                {isConfigLoading
                  ? '读取模型配置中...'
                  : configError
                    ? '配置读取失败'
                    : result?.model || model || '未配置'}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-[12px] font-medium text-[#888888]">发送内容</span>
              <span className="flex-1 font-mono text-[13px] text-[#333333] break-all select-text">Introduce yourself.</span>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-[12px] font-medium text-[#888888]">返回内容</span>
              <div className="min-h-[120px] rounded-lg border border-[#EAEAEA] bg-[#FAFAFA] px-4 py-3.5">
                {isSending ? (
                  streamedText ? (
                    <p className="whitespace-pre-wrap break-words select-text text-[13px] text-[#333333] leading-relaxed">
                      {streamedText}
                      <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-black/40 align-middle" />
                    </p>
                  ) : (
                    <div className="flex items-center gap-2.5 text-[13px] text-[#666666]">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                      正在调用模型接口...
                    </div>
                  )
                ) : error ? (
                  <div className="flex items-start gap-2 break-all text-[12px] text-[#D32F2F] leading-relaxed">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
                    <span>{error}</span>
                  </div>
                ) : result ? (
                  <p className="whitespace-pre-wrap break-words select-text text-[13px] text-[#333333] leading-relaxed">
                    {result.output || '(无返回内容)'}
                  </p>
                ) : (
                  <span className="text-[12px] text-[#999999]">
                    点击下方“发送”按钮，用该账号调用模型接口发送 “Introduce yourself.”。
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-lg border border-[#EAEAEA] bg-[#F9F9F9] px-3.5 py-2.5 text-[11px] text-[#777777]">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>
              本次测试会消耗该账号额度，发送成功后已自动刷新额度。
            </div>
          </div>
        </div>

        <div className="px-5 py-3 bg-[#FAFAFA] border-t border-[#EAEAEA] flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isSending}
            className="px-4 py-1.5 text-[13px] font-medium text-[#666666] hover:bg-[#F0F0F0] hover:text-black rounded-md transition-colors disabled:opacity-50"
          >
            关闭
          </button>
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!canSend}
            title={model ? '发送测试消息' : '未配置模型，无法发送'}
            className="min-w-[88px] px-4 py-1.5 bg-black hover:bg-[#333333] text-white text-[13px] font-medium rounded-md transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isSending && (
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            )}
            {isSending ? '发送中...' : '发送'}
          </button>
        </div>
      </div>
    </div>
  );
}
