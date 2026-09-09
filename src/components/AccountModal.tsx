import React, { useState, useEffect } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Account, AccountFormData, OAuthLoginInfo, RtTokenInfo, SaveRtAccountParams, TokenInfo } from '../types/account';
import Select from './Select';
import Button from './ui/button';
import Input from './ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';

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
    if (!isOpen || step !== 'oauth' || !oauthInfo) return;
    let disposed = false;
    let timer: number | undefined;

    const poll = async () => {
      if (disposed) return;
      try {
        const info = await onCheckOauth();
        if (info) {
          if (!disposed) {
            setOauthRtInfo(info);
            setStep('confirm');
          }
          return;
        }
      } catch {
        // 轮询中的瞬时错误忽略
      }
      // 等本次请求完成再继续，避免授权码兑换较慢时产生重叠请求。
      if (!disposed) timer = window.setTimeout(() => void poll(), 1500);
    };

    timer = window.setTimeout(() => void poll(), 0);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [isOpen, step, oauthInfo, onCheckOauth]);

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
          idToken: rtToSave.idToken,
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
    <div className="flex flex-col gap-3 pt-2">
      {renderError()}
      <DialogFooter className="pt-0">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onSecondary}
          disabled={primaryBusy}
        >
          {secondaryLabel}
        </Button>
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={onPrimary}
          disabled={primaryBusy || disabledPrimary}
          className="min-w-[90px]"
        >
          {primaryBusy ? '处理中...' : primaryLabel}
        </Button>
      </DialogFooter>
    </div>
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[490px] p-6 sm:p-7 gap-5">
        <DialogHeader>
          <DialogTitle>
            {editingAccount ? '编辑账号配置' : '新增账号配置'}
          </DialogTitle>
          <DialogDescription>
            {editingAccount
              ? '修改该账号的认证 Token 或备注信息。'
              : '配置 Codex 认证凭据，支持 PAT、Refresh Token 及 OAuth 登录。'}
          </DialogDescription>
        </DialogHeader>

        {unsupportedFormat ? (
          <div className="py-6 text-center space-y-4">
            <p className="text-[13px] text-[#666666] leading-relaxed">
              该账号为 OAuth / Refresh Token 登录的账号，无法直接编辑。<br />可删除后重新添加。
            </p>
            <Button onClick={onClose} size="sm">
              关闭
            </Button>
          </div>
        ) : step === 'form' ? (
          <div className="flex flex-col gap-5">
            <div className="space-y-4">
              <div>
                <label className="block text-[12px] font-medium text-[#222222] mb-1.5">
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
                  <p className="text-[11px] text-[#888888] mt-1.5">
                    Refresh Token 一次性使用，兑换后旧 rt 失效；Team 账号同样支持。
                  </p>
                )}
                {isOauth && (
                  <p className="text-[11px] text-[#888888] mt-1.5">
                    支持个人与 Team 账号。生成 Codex 登录链接，浏览器登录后自动回跳本机完成认证。
                  </p>
                )}
              </div>

              {!isOauth && (
                <div>
                  <label htmlFor="tokenInput" className="block text-[12px] font-medium text-[#222222] mb-1.5">
                    {isRt ? 'Refresh Token' : 'Personal Access Token'} <span className="text-[#D32F2F]">*</span>
                  </label>
                  <Input
                    type="text"
                    id="tokenInput"
                    value={input}
                    onChange={(e) => { setInput(e.target.value); setError(null); }}
                    placeholder={isRt ? '可粘贴 JSON（自动提取 refresh_token）或直接粘贴 rt...' : '在此输入或粘贴 Token...'}
                    className="font-mono text-[12px]"
                  />
                  {!isRt && isTokenUnchanged && (
                    <p className="mt-1.5 text-[11px] text-emerald-600">
                      Token 未变化，保存将仅更新备注，不会重新获取信息与额度。
                    </p>
                  )}
                </div>
              )}

              <div>
                <label htmlFor="notes" className="block text-[12px] font-medium text-[#222222] mb-1.5">
                  备注 (可选)
                </label>
                <Input
                  type="text"
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="例如：这是用于测试环境的临时账号..."
                  className="text-[13px]"
                />
              </div>

              <div className="flex items-start gap-2.5 rounded-xl border border-[#EAEAEA] bg-[#F9F9F9] p-3 text-[12px] text-[#666666] leading-relaxed">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5 text-[#888888]"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
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
              isOauth ? isValidating : isTokenUnchanged && !isRt ? isSubmitting : isValidating,
              () => {
                if (isOauth) {
                  void handleStartOauth();
                } else if (isTokenUnchanged && !isRt) {
                  void handleConfirmSave();
                } else {
                  void handleValidate();
                }
              },
              !isOauth && !input.trim(),
              '取消',
              onClose,
            )}
          </div>
        ) : step === 'oauth' ? (
          <div className="flex flex-col gap-5">
            <div className="space-y-4">
              <div className="flex items-center gap-2.5 text-[13px] text-[#555555]">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin text-black"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                等待登录回调...（在本机浏览器登录成功后自动完成）
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-[12px] font-medium text-[#222222]">登录链接</label>
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    readOnly
                    value={oauthInfo?.url || ''}
                    className="text-[11px] text-[#666666] font-mono bg-[#F7F7F7]"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleCopyUrl()}
                    className="shrink-0"
                  >
                    {copied ? '已复制' : '复制'}
                  </Button>
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    onClick={() => void handleOpenBrowser()}
                    className="shrink-0"
                  >
                    打开浏览器
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-[#EAEAEA]" />
                <span className="text-[11px] text-[#999999]">或</span>
                <div className="h-px flex-1 bg-[#EAEAEA]" />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-[12px] font-medium text-[#222222]">
                  在其他设备登录后，粘贴浏览器回跳的 localhost 地址
                </label>
                <Input
                  type="text"
                  value={manualUrl}
                  onChange={(e) => { setManualUrl(e.target.value); setError(null); }}
                  placeholder="http://localhost:端口/auth/callback?code=...&state=..."
                  className="font-mono text-[11px]"
                />
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={() => void handleManualComplete()}
                  disabled={isValidating}
                  className="self-end"
                >
                  {isValidating ? '处理中...' : '完成认证'}
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-3 pt-2">
              {renderError()}
              <DialogFooter className="pt-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setStep('form')}
                >
                  返回
                </Button>
              </DialogFooter>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="space-y-4">
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

              <div className="flex items-start gap-2.5 rounded-xl border border-[#EAEAEA] bg-[#F9F9F9] p-3 text-[12px] text-[#666666] leading-relaxed">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5 text-[#888888]"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
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
      </DialogContent>
    </Dialog>
  );
};

export default AccountModal;
