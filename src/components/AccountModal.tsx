import React, { useState, useEffect, useRef } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Account, AccountFormData, OAuthLoginInfo, RtTokenInfo, SaveRtAccountParams, TokenInfo } from '../types/account';
import Select from './Select';

interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: AccountFormData, shouldRefreshUsage?: boolean) => Promise<void>;
  onValidate: (token: string) => Promise<TokenInfo>;
  onExchangeRt: (input: string) => Promise<RtTokenInfo>;
  onSaveRt: (params: SaveRtAccountParams) => Promise<Account>;
  onStartOauth: () => Promise<OAuthLoginInfo>;
  onCheckOauth: () => Promise<RtTokenInfo | null>;
  onCompleteOauth: (redirectUrl: string) => Promise<RtTokenInfo>;
  editingAccount?: Account | null;
}

const PLAN_LABELS: Record<string, string> = {
  team: 'Team',
  plus: 'Plus',
  pro: 'Pro',
  free: 'Free',
};

type AuthMethod = 'personal' | 'refresh' | 'oauth';
type Step = 'form' | 'oauth' | 'confirm';

const AccountModal: React.FC<AccountModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  onValidate,
  onExchangeRt,
  onSaveRt,
  onStartOauth,
  onCheckOauth,
  onCompleteOauth,
  editingAccount,
}) => {
  const [authMethod, setAuthMethod] = useState<AuthMethod>('personal');
  const [input, setInput] = useState('');
  const [originalToken, setOriginalToken] = useState('');
  const [notes, setNotes] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [personalInfo, setPersonalInfo] = useState<TokenInfo | null>(null);
  const [rtInfo, setRtInfo] = useState<RtTokenInfo | null>(null);
  const [oauthInfo, setOauthInfo] = useState<OAuthLoginInfo | null>(null);
  const [oauthRtInfo, setOauthRtInfo] = useState<RtTokenInfo | null>(null);
  const [manualUrl, setManualUrl] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unsupportedFormat, setUnsupportedFormat] = useState(false);
  const [copied, setCopied] = useState(false);
  const oauthStartedRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    setStep('form');
    setPersonalInfo(null);
    setRtInfo(null);
    setOauthInfo(null);
    setOauthRtInfo(null);
    setManualUrl('');
    setIsValidating(false);
    setIsSubmitting(false);
    setError(null);
    setCopied(false);
    oauthStartedRef.current = false;

    if (editingAccount) {
      setAuthMethod('personal');
      let token = '';
      try {
        const parsed = JSON.parse(editingAccount.authJsonContent);
        if (parsed.personal_access_token) token = parsed.personal_access_token;
      } catch {
        // ignore
      }
      setUnsupportedFormat(!token);
      setOriginalToken(token);
      setInput(token);
      setNotes(editingAccount.notes || '');
    } else {
      setAuthMethod('personal');
      setUnsupportedFormat(false);
      setOriginalToken('');
      setInput('');
      setNotes('');
    }
  }, [isOpen, editingAccount]);

  // OAuth 回调轮询：本机浏览器登录成功后自动捕获。
  useEffect(() => {
    if (step !== 'oauth' || !oauthInfo || oauthStartedRef.current) return;
    oauthStartedRef.current = true;
    let disposed = false;

    const poll = async () => {
      if (disposed) return;
      try {
        const info = await onCheckOauth();
        if (info && !disposed) {
          setOauthRtInfo(info);
          setStep('confirm');
        }
      } catch {
        // 轮询中的瞬时错误忽略
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 1500);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [step, oauthInfo, onCheckOauth]);

  if (!isOpen) return null;

  const isTokenUnchanged = editingAccount ? input.trim() === originalToken : false;
  const isRt = authMethod === 'refresh';
  const isOauth = authMethod === 'oauth';

  const handleStartOauth = async () => {
    setError(null);
    setIsValidating(true);
    try {
      const info = await onStartOauth();
      setOauthInfo(info);
      setStep('oauth');
    } catch (err: any) {
      setError(err?.toString() || '启动 OAuth 登录失败');
    } finally {
      setIsValidating(false);
    }
  };

  const handleCopyUrl = async () => {
    if (!oauthInfo) return;
    try {
      await navigator.clipboard.writeText(oauthInfo.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('复制失败');
    }
  };

  const handleOpenBrowser = async () => {
    if (!oauthInfo) return;
    try {
      await openUrl(oauthInfo.url);
    } catch {
      setError('打开浏览器失败，请手动复制链接');
    }
  };

  const handleManualComplete = async () => {
    setError(null);
    if (!manualUrl.trim()) {
      setError('请粘贴回调地址');
      return;
    }
    setIsValidating(true);
    try {
      const info = await onCompleteOauth(manualUrl.trim());
      setOauthRtInfo(info);
      setStep('confirm');
    } catch (err: any) {
      setError(err?.toString() || '回调完成失败');
    } finally {
      setIsValidating(false);
    }
  };

  const handleValidate = async () => {
    setError(null);
    if (!input.trim()) {
      setError(isRt ? '请输入 Refresh Token' : '请输入 Token');
      return;
    }
    setIsValidating(true);
    try {
      if (isRt) {
        setRtInfo(await onExchangeRt(input));
      } else {
        setPersonalInfo(await onValidate(input.trim()));
      }
      setStep('confirm');
    } catch (err: any) {
      setError(err?.toString() || '验证失败');
    } finally {
      setIsValidating(false);
    }
  };

  const handleConfirmSave = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const rtToSave = isRt ? rtInfo : oauthRtInfo;
      if (isRt || isOauth) {
        if (!rtToSave) return;
        await onSaveRt({
          email: rtToSave.email,
          chatgptPlanType: rtToSave.chatgptPlanType,
          chatgptAccountId: rtToSave.chatgptAccountId,
          accessToken: rtToSave.accessToken,
          refreshToken: rtToSave.refreshToken,
          atExpiresAt: rtToSave.atExpiresAt,
          notes,
        });
      } else {
        await onSubmit({ token: input.trim(), notes }, !isTokenUnchanged);
      }
    } catch (err: any) {
      setError(err?.message || err?.toString() || '保存时发生未知错误');
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmRt = (isRt ? rtInfo : oauthRtInfo) || null;
  const confirmEmail = confirmRt?.email || personalInfo?.email || '';
  const confirmPlanRaw = confirmRt?.chatgptPlanType || personalInfo?.chatgptPlanType || '';
  const confirmPlanLabel = PLAN_LABELS[confirmPlanRaw.toLowerCase()] || confirmPlanRaw || '未知';

  const renderError = () =>
    error ? (
      <div className="flex items-start gap-1.5 px-3 py-2 bg-[#FFF0F0] border border-[#FFD0D0] text-[#D32F2F] text-[12px] rounded-md">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
        <span className="break-all">{error}</span>
      </div>
    ) : null;

  const renderFooterButtons = (
    primaryLabel: string,
    primaryBusy: boolean,
    onPrimary: () => void,
    disabledPrimary: boolean,
    secondaryLabel: string,
    onSecondary: () => void,
  ) => (
    <div className="px-5 py-3 bg-[#FAFAFA] border-t border-[#EAEAEA] flex flex-col gap-3 mt-auto">
      {renderError()}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onSecondary}
          disabled={primaryBusy}
          className="px-4 py-1.5 text-[12px] font-medium text-[#333333] bg-white border border-[#EAEAEA] rounded hover:bg-[#F9F9F9] hover:text-black transition-colors shadow-sm disabled:opacity-50"
        >
          {secondaryLabel}
        </button>
        <button
          type="button"
          onClick={onPrimary}
          disabled={primaryBusy || disabledPrimary}
          className="px-4 py-1.5 text-[12px] font-medium text-white bg-black border border-transparent rounded hover:bg-[#333333] focus:ring-2 focus:ring-black/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm min-w-[80px] flex justify-center"
        >
          {primaryBusy ? '处理中...' : primaryLabel}
        </button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/20 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      <div className="relative w-full max-w-[480px] bg-white rounded-xl shadow-2xl animate-modal-in overflow-hidden flex flex-col border border-[#EAEAEA]">
        <div className="flex justify-between items-center px-5 py-3 border-b border-[#EAEAEA] bg-[#FAFAFA]">
          <h2 className="text-[14px] font-semibold text-black tracking-tight">
            {editingAccount ? '编辑账号配置' : '新增账号配置'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-[#999999] hover:text-black rounded transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {unsupportedFormat ? (
          <div className="p-8 text-center">
            <p className="text-[14px] text-[#555555] mb-5">该账号为 Refresh Token / 自定义认证，当前暂不支持直接编辑。<br/>可删除后重新添加。</p>
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-[12px] font-medium text-white bg-black rounded hover:bg-[#333333] transition-colors"
            >
              关闭
            </button>
          </div>
        ) : step === 'form' ? (
          <div className="flex flex-col max-h-[85vh]">
            <div className="p-5 space-y-4 overflow-y-auto custom-scrollbar flex-1">
              <div>
                <label className="block text-[12px] font-medium text-black mb-1.5">
                  认证方式 <span className="text-[#D32F2F]">*</span>
                </label>
                <Select
                  value={authMethod}
                  onChange={(value) => { setAuthMethod(value as AuthMethod); setStep('form'); setError(null); setPersonalInfo(null); setRtInfo(null); setOauthInfo(null); setOauthRtInfo(null); }}
                  options={[
                    { value: 'personal', label: 'Personal Access Token' },
                    { value: 'refresh', label: 'Refresh Token' },
                    { value: 'oauth', label: 'OAuth 登录' }
                  ]}
                />
                {isRt && (
                  <p className="text-[11px] text-[#999999] mt-1.5">
                    适用于非 Team 账号。Refresh Token 一次性使用，兑换后旧 rt 失效。
                  </p>
                )}
                {isOauth && (
                  <p className="text-[11px] text-[#999999] mt-1.5">
                    生成 Codex 登录链接，浏览器登录后自动回跳本机完成认证。
                  </p>
                )}
              </div>

              {!isOauth && (
                <div>
                  <label htmlFor="tokenInput" className="block text-[12px] font-medium text-black mb-1.5">
                    {isRt ? 'Refresh Token' : 'Personal Access Token'} <span className="text-[#D32F2F]">*</span>
                  </label>
                  <input
                    type="text"
                    id="tokenInput"
                    value={input}
                    onChange={(e) => { setInput(e.target.value); setError(null); }}
                    placeholder={isRt ? '可粘贴 JSON（自动提取 refresh_token）或直接粘贴 rt...' : '在此输入或粘贴 Token...'}
                    className="w-full px-3 py-2 bg-white border border-[#EAEAEA] rounded-md focus:border-black focus:ring-1 focus:ring-black outline-none transition-all text-black placeholder-[#A0A0A0] text-[13px] font-mono"
                  />
                  {!isRt && isTokenUnchanged && (
                    <p className="mt-1.5 text-[11px] text-emerald-600">
                      Token 未变化，保存将仅更新备注，不会重新获取信息与额度。
                    </p>
                  )}
                </div>
              )}

              <div>
                <label htmlFor="notes" className="block text-[12px] font-medium text-black mb-1.5">
                  备注 (可选)
                </label>
                <input
                  type="text"
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="例如：这是用于测试环境的临时账号..."
                  className="w-full px-3 py-2 bg-white border border-[#EAEAEA] rounded-md focus:border-black focus:ring-1 focus:ring-black outline-none transition-all text-black placeholder-[#A0A0A0] text-[13px]"
                />
              </div>

              <div className="flex items-start gap-2 rounded-lg border border-[#EAEAEA] bg-[#F9F9F9] px-3.5 py-2.5 text-[11px] text-[#777777]">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                <span>
                  {isOauth
                    ? '登录成功后邮箱与订阅自动解析；限额类型在额度刷新后自动判断。'
                    : isRt
                      ? '邮箱与订阅将从兑换的 Access Token 自动解析；额度将在刷新后自动获取。'
                      : '邮箱与订阅信息将自动从 Token 解析；限额类型（周限/月限）将在额度刷新后自动判断。'}
                </span>
              </div>
            </div>

            {renderFooterButtons(
              isOauth ? '开始 OAuth 登录' : isTokenUnchanged && !isRt ? '保存' : '验证并继续',
              isValidating,
              () => (isOauth ? void handleStartOauth() : void handleValidate()),
              !isOauth && !input.trim(),
              '取消',
              onClose,
            )}
          </div>
        ) : step === 'oauth' ? (
          <div className="flex flex-col max-h-[85vh]">
            <div className="p-5 space-y-4 overflow-y-auto custom-scrollbar flex-1">
              <div className="flex items-center gap-2.5 text-[13px] text-[#666666]">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                等待登录回调...（在本机浏览器登录成功后自动完成）
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-[12px] font-medium text-black">登录链接</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={oauthInfo?.url || ''}
                    className="flex-1 min-w-0 px-3 py-2 bg-[#F7F7F7] border border-[#EAEAEA] rounded-md text-[11px] text-[#666666] font-mono select-text"
                  />
                  <button
                    type="button"
                    onClick={() => void handleCopyUrl()}
                    className="shrink-0 px-3 py-2 text-[12px] font-medium bg-white border border-[#EAEAEA] rounded-md hover:border-black hover:text-black transition-colors"
                  >
                    {copied ? '已复制' : '复制'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleOpenBrowser()}
                    className="shrink-0 px-3 py-2 text-[12px] font-medium bg-black text-white rounded-md hover:bg-[#333333] transition-colors"
                  >
                    打开浏览器
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-[#EAEAEA]" />
                <span className="text-[11px] text-[#999999]">或</span>
                <div className="h-px flex-1 bg-[#EAEAEA]" />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-[12px] font-medium text-black">
                  在其他设备登录后，粘贴浏览器回跳的 localhost 地址
                </label>
                <input
                  type="text"
                  value={manualUrl}
                  onChange={(e) => { setManualUrl(e.target.value); setError(null); }}
                  placeholder="http://localhost:端口/auth/callback?code=...&state=..."
                  className="w-full px-3 py-2 bg-white border border-[#EAEAEA] rounded-md focus:border-black focus:ring-1 focus:ring-black outline-none transition-all text-black placeholder-[#A0A0A0] text-[12px] font-mono"
                />
                <button
                  type="button"
                  onClick={() => void handleManualComplete()}
                  disabled={isValidating}
                  className="self-end px-4 py-1.5 text-[12px] font-medium bg-black text-white rounded-md hover:bg-[#333333] transition-colors disabled:opacity-50"
                >
                  {isValidating ? '处理中...' : '完成认证'}
                </button>
              </div>
            </div>

            <div className="px-5 py-3 bg-[#FAFAFA] border-t border-[#EAEAEA] flex flex-col gap-3 mt-auto">
              {renderError()}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setStep('form')}
                  className="px-4 py-1.5 text-[12px] font-medium text-[#333333] bg-white border border-[#EAEAEA] rounded hover:bg-[#F9F9F9] hover:text-black transition-colors shadow-sm"
                >
                  返回
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col max-h-[85vh]">
            <div className="p-5 space-y-4 overflow-y-auto custom-scrollbar flex-1">
              <div className="rounded-xl border border-[#EAEAEA] bg-[#FAFAFA] p-4 space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[12px] text-[#888888] shrink-0">账号邮箱</span>
                  <span className="text-[14px] font-medium text-black select-text break-all text-right">{confirmEmail}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[12px] text-[#888888] shrink-0">订阅方式</span>
                  <span className="text-[14px] font-medium text-black">{confirmPlanLabel}</span>
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-lg border border-[#EAEAEA] bg-[#F9F9F9] px-3.5 py-2.5 text-[11px] text-[#777777]">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                <span>
                  {isOauth
                    ? '确认后保存账号；登录已成功，Refresh Token 将用于后续自动刷新。'
                    : isRt
                      ? '确认后保存账号；Refresh Token 已一次性消耗，无法重复兑换。'
                      : '确认后保存账号；限额类型（周限/月限）将在额度刷新后根据接口返回自动判断。'}
                </span>
              </div>
            </div>

            {renderFooterButtons('确认保存', isSubmitting, () => void handleConfirmSave(), false, '返回修改', () => setStep(isOauth ? 'oauth' : 'form'))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AccountModal;
