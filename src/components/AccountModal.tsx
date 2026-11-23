import React, { useState, useEffect, useRef } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Account, AccountFormData, OAuthLoginInfo, RtTokenInfo, SaveApiKeyAccountParams, SaveRtAccountParams, TokenInfo } from '../types/account';
import { getAccountApiKey, isApiKeyAccount } from '../utils/accountAuth';
import { getDisplayedEmail } from '../utils/accountEmail';
import PlanBadge from './PlanBadge';
import Select from './Select';
import Button from './ui/button';
import Input from './ui/input';
import { toast } from './ui/toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import { CircleAlert, Info, LoaderCircle } from 'lucide-react';

interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: AccountFormData, shouldRefreshUsage?: boolean) => Promise<void>;
  onValidate: (token: string) => Promise<TokenInfo>;
  onExchangeRt: (input: string) => Promise<RtTokenInfo>;
  onSaveRt: (params: SaveRtAccountParams) => Promise<Account>;
  onSaveApiKey: (params: SaveApiKeyAccountParams) => Promise<Account>;
  onSaveNotes: (id: string, notes: string) => Promise<void>;
  onReauthOauth: (id: string, params: SaveRtAccountParams) => Promise<Account>;
  onStartOauth: () => Promise<OAuthLoginInfo>;
  onCheckOauth: () => Promise<RtTokenInfo | null>;
  onCompleteOauth: (redirectUrl: string) => Promise<RtTokenInfo>;
  editingAccount?: Account | null;
  isEmailMaskingEnabled: boolean;
}

const PLAN_LABELS: Record<string, string> = {
  team: 'Team',
  plus: 'Plus',
  pro: 'Pro',
  free: 'Free',
};

type AuthMethod = 'personal' | 'refresh' | 'oauth' | 'apiKey';
type Step = 'form' | 'oauth' | 'confirm';

function oauthDetails(account: Account) {
  try {
    const tokens = JSON.parse(account.authJsonContent).tokens;
    const maskedToken = (token: unknown) => (typeof token === 'string' && token ? `•••• ${token.slice(-4)}` : '未保存');
    return {
      accountId: typeof tokens?.account_id === 'string' ? tokens.account_id : '未保存',
      accessToken: maskedToken(tokens?.access_token),
      refreshToken: maskedToken(tokens?.refresh_token),
    };
  } catch {
    return { accountId: '未保存', accessToken: '未保存', refreshToken: '未保存' };
  }
}

function getOauthReauthError(account: Account, info: RtTokenInfo | null, isEmailMaskingEnabled: boolean): string | null {
  if (!info) return null;
  let storedAccountId: string | null = null;
  try {
    const accountId = JSON.parse(account.authJsonContent).tokens?.account_id;
    if (typeof accountId === 'string') storedAccountId = accountId;
  } catch {
    // ignore
  }
  const accountIdMismatch = storedAccountId !== null && info.chatgptAccountId != null
    && storedAccountId !== info.chatgptAccountId;
  if (account.name.toLowerCase() === info.email.toLowerCase() && !accountIdMismatch) return null;
  return `登录的账号与当前账号不一致，请登录 ${getDisplayedEmail(account.name, isEmailMaskingEnabled)}。`;
}

function formatTokenExpiry(expiry: string | null): string {
  const date = expiry ? new Date(expiry) : null;
  return date && Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(date)
    : '未知';
}

const AccountModal: React.FC<AccountModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  onValidate,
  onExchangeRt,
  onSaveRt,
  onSaveApiKey,
  onSaveNotes,
  onReauthOauth,
  onStartOauth,
  onCheckOauth,
  onCompleteOauth,
  editingAccount,
  isEmailMaskingEnabled,
}) => {
  const [authMethod, setAuthMethod] = useState<AuthMethod>('personal');
  const [input, setInput] = useState('');
  const [originalToken, setOriginalToken] = useState('');
  const [notes, setNotes] = useState('');
  const [name, setName] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [personalInfo, setPersonalInfo] = useState<TokenInfo | null>(null);
  const [rtInfo, setRtInfo] = useState<RtTokenInfo | null>(null);
  const [oauthInfo, setOauthInfo] = useState<OAuthLoginInfo | null>(null);
  const [oauthRtInfo, setOauthRtInfo] = useState<RtTokenInfo | null>(null);
  const [manualUrl, setManualUrl] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const modalRevision = useRef(0);
  const isEditingOauth = editingAccount?.authMethod === 'oauth';

  useEffect(() => {
    modalRevision.current += 1;
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
    setName(editingAccount?.name || '');

    if (editingAccount) {
      const apiKey = isApiKeyAccount(editingAccount);
      setAuthMethod(apiKey ? 'apiKey' : editingAccount.authMethod === 'oauth' ? 'oauth' : 'personal');
      let token = '';
      try {
        const parsed = JSON.parse(editingAccount.authJsonContent);
        if (apiKey) token = getAccountApiKey(editingAccount);
        else if (parsed.personal_access_token) token = parsed.personal_access_token;
      } catch {
        // ignore
      }
      setOriginalToken(token);
      setInput(token);
      setNotes(editingAccount.notes || '');
    } else {
      setAuthMethod('personal');
      setOriginalToken('');
      setInput('');
      setNotes('');
    }
  }, [isOpen, editingAccount]);

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
      } catch (err: any) {
        if (!disposed) {
          setError(err?.toString() || 'OAuth 登录失败，请重新登录');
          setStep('form');
        }
        return;
      }
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
  const isApiKey = authMethod === 'apiKey';
  const details = isEditingOauth && editingAccount ? oauthDetails(editingAccount) : null;

  const handleStartOauth = async () => {
    const revision = modalRevision.current;
    setError(null);
    setIsValidating(true);
    try {
      const info = await onStartOauth();
      if (revision !== modalRevision.current) return;
      setOauthInfo(info);
      setStep('oauth');
    } catch (err: any) {
      if (revision === modalRevision.current) setError(err?.toString() || '启动 OAuth 登录失败');
    } finally {
      if (revision === modalRevision.current) setIsValidating(false);
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
    const revision = modalRevision.current;
    setError(null);
    if (!manualUrl.trim()) {
      setError('请粘贴回调地址');
      return;
    }
    setIsValidating(true);
    try {
      const info = await onCompleteOauth(manualUrl.trim());
      if (revision !== modalRevision.current) return;
      setOauthRtInfo(info);
      setStep('confirm');
    } catch (err: any) {
      if (revision === modalRevision.current) setError(err?.toString() || '回调完成失败');
    } finally {
      if (revision === modalRevision.current) setIsValidating(false);
    }
  };

  const handleValidate = async () => {
    const revision = modalRevision.current;
    setError(null);
    if (!input.trim()) {
      setError(isRt ? '请输入 Refresh Token' : '请输入 Token');
      return;
    }
    setIsValidating(true);
    try {
      if (isRt) {
        const info = await onExchangeRt(input);
        if (revision !== modalRevision.current) return;
        setRtInfo(info);
      } else {
        const info = await onValidate(input.trim());
        if (revision !== modalRevision.current) return;
        setPersonalInfo(info);
      }
      setStep('confirm');
    } catch (err: any) {
      if (revision === modalRevision.current) setError(err?.toString() || '验证失败');
    } finally {
      if (revision === modalRevision.current) setIsValidating(false);
    }
  };

  const handleConfirmSave = async () => {
    if (reauthIdentityError) return;
    const revision = modalRevision.current;
    setIsSubmitting(true);
    setError(null);
    try {
      if (isApiKey) {
        await onSaveApiKey({ id: editingAccount?.id, name, apiKey: input.trim(), notes });
        return;
      }
      const rtToSave = isRt ? rtInfo : oauthRtInfo;
      if (isRt || isOauth) {
        if (!rtToSave) return;
        const params: SaveRtAccountParams = {
          email: rtToSave.email,
          chatgptPlanType: rtToSave.chatgptPlanType,
          chatgptAccountId: rtToSave.chatgptAccountId,
          idToken: rtToSave.idToken,
          accessToken: rtToSave.accessToken,
          refreshToken: rtToSave.refreshToken,
          atExpiresAt: rtToSave.atExpiresAt,
          notes,
        };
        if (isEditingOauth && editingAccount) {
          await onReauthOauth(editingAccount.id, params);
        } else {
          await onSaveRt(params);
        }
      } else {
        await onSubmit({ token: input.trim(), notes }, !isTokenUnchanged);
      }
    } catch (err: any) {
      if (revision === modalRevision.current) setError(err?.message || err?.toString() || '保存时发生未知错误');
    } finally {
      if (revision === modalRevision.current) setIsSubmitting(false);
    }
  };

  const handleSaveNotes = async () => {
    if (!editingAccount) return;
    const revision = modalRevision.current;
    setIsSubmitting(true);
    setError(null);
    try {
      await onSaveNotes(editingAccount.id, notes);
      if (revision === modalRevision.current) toast.success('备注已保存');
    } catch (err: any) {
      if (revision === modalRevision.current) setError(err?.toString() || '备注保存失败');
    } finally {
      if (revision === modalRevision.current) setIsSubmitting(false);
    }
  };

  const confirmRt = (isRt ? rtInfo : oauthRtInfo) || null;
  const confirmEmail = confirmRt?.email || personalInfo?.email || '';
  const confirmPlanRaw = confirmRt?.chatgptPlanType || personalInfo?.chatgptPlanType || '';
  const confirmPlanLabel = PLAN_LABELS[confirmPlanRaw.toLowerCase()] || confirmPlanRaw || '未知';
  const reauthIdentityError = isEditingOauth && editingAccount
    ? getOauthReauthError(editingAccount, confirmRt, isEmailMaskingEnabled)
    : null;
  const visibleError = step === 'confirm' ? reauthIdentityError || error : error;

  const renderError = () =>
    visibleError ? (
      <div className="flex items-start gap-2 rounded-[10px] bg-destructive/10 px-3 py-2 text-label text-destructive">
        <CircleAlert size={14} className="mt-0.5 shrink-0" />
        <span className="break-all">{visibleError}</span>
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
    <div className="flex flex-col gap-3 border-t border-[var(--hairline-divider)] pt-3">
      {renderError()}
      <DialogFooter className="pt-0">
        <Button type="button" variant="outline" size="sm" onClick={onSecondary} disabled={primaryBusy}>
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
          {primaryBusy ? '处理中…' : primaryLabel}
        </Button>
      </DialogFooter>
    </div>
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open && !(isEditingOauth && isSubmitting)) onClose(); }}>
      <DialogContent className={`max-w-[490px] gap-5 p-6 ${isEditingOauth ? 'max-h-[90vh] overflow-y-auto' : ''}`}>
        <DialogHeader>
          <DialogTitle>
            {editingAccount ? '编辑账号配置' : '新增账号配置'}
          </DialogTitle>
          <DialogDescription>
            {editingAccount
              ? isEditingOauth
                ? '查看登录信息、修改备注或重新登录更新凭证。'
                : '修改该账号的认证 Token 或备注信息。'
              : '支持 OpenAI 官方 API Key、PAT、Refresh Token 及 OAuth 登录。'}
          </DialogDescription>
        </DialogHeader>

        {step === 'form' && isEditingOauth && editingAccount ? (
          <div className="flex flex-col gap-5">
            <dl className="bento-group grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2.5 p-4 text-label">
              <dt className="text-[var(--label)]">账号邮箱</dt>
              <dd className="min-w-0 break-all text-right font-medium select-text">
                {getDisplayedEmail(editingAccount.name, isEmailMaskingEnabled)}
              </dd>
              <dt className="text-[var(--label)]">订阅</dt>
              <dd className="flex justify-end">
                {editingAccount.chatgptPlanType
                  ? <PlanBadge planType={editingAccount.chatgptPlanType} accountType={editingAccount.accountType} />
                  : '未知'}
              </dd>
              <dt className="text-[var(--label)]">认证方式</dt>
              <dd className="text-right">OAuth / Refresh Token</dd>
              <dt className="text-[var(--label)]">ChatGPT 账号 ID</dt>
              <dd className="min-w-0 break-all text-right font-mono text-caption select-text">{details?.accountId}</dd>
              <dt className="text-[var(--label)]">Access Token 过期时间</dt>
              <dd className="text-right tabular-nums">{formatTokenExpiry(editingAccount.atExpiresAt)}</dd>
              <dt className="text-[var(--label)]">凭证状态</dt>
              <dd className={`text-right font-medium ${editingAccount.canActivate ? 'text-success' : 'text-warning'}`}>
                {editingAccount.canActivate ? '完整' : '需重新登录'}
              </dd>
              <dt className="text-[var(--label)]">Access Token</dt>
              <dd className="text-right font-mono text-caption">{details?.accessToken}</dd>
              <dt className="text-[var(--label)]">Refresh Token</dt>
              <dd className="text-right font-mono text-caption">{details?.refreshToken}</dd>
            </dl>

            <div>
              <label htmlFor="oauthNotes" className="mb-1.5 block text-label font-medium">备注 (可选)</label>
              <div className="flex items-center gap-2">
                <Input
                  id="oauthNotes"
                  value={notes}
                  onChange={event => setNotes(event.target.value)}
                  placeholder="为账号添加备注…"
                  className="min-w-0 text-body"
                  disabled={isSubmitting}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 shrink-0"
                  disabled={isSubmitting || isValidating}
                  onClick={() => void handleSaveNotes()}
                >
                  保存
                </Button>
              </div>
            </div>

            <div className="space-y-3 border-t border-[var(--hairline-divider)] pt-4">
              <div>
                <h3 className="text-body font-semibold">重新登录</h3>
                <p className="mt-1 text-caption text-[var(--label)]">请登录同一账号，确认后替换此账号的登录凭证。</p>
              </div>
              <Select
                value={authMethod}
                disabled={isValidating || isSubmitting}
                onChange={value => {
                  setAuthMethod(value as 'oauth' | 'refresh');
                  setInput('');
                  setRtInfo(null);
                  setOauthInfo(null);
                  setOauthRtInfo(null);
                  setManualUrl('');
                  setError(null);
                }}
                options={[
                  { value: 'oauth', label: 'OAuth 登录' },
                  { value: 'refresh', label: 'Refresh Token' },
                ]}
              />
              {isRt && (
                <div>
                  <label htmlFor="reauthRefreshToken" className="mb-1.5 block text-label font-medium">Refresh Token</label>
                  <Input
                    id="reauthRefreshToken"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={input}
                    onChange={event => { setInput(event.target.value); setError(null); }}
                    placeholder="粘贴新的 Refresh Token 或登录 JSON"
                    className="font-mono text-body"
                  />
                  <p className="mt-1.5 text-caption text-[var(--label)]">Refresh Token 一次性使用，兑换后旧凭证失效。</p>
                </div>
              )}
            </div>
            {renderFooterButtons(
              isRt ? '验证并继续' : '开始 OAuth 登录',
              isValidating || isSubmitting,
              () => { if (isRt) void handleValidate(); else void handleStartOauth(); },
              isRt && !input.trim(),
              '关闭',
              onClose,
            )}
          </div>
        ) : step === 'form' ? (
          <div className="flex flex-col gap-5">
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-label font-medium text-foreground">
                  认证方式 <span className="text-destructive">*</span>
                </label>
                <Select
                  value={authMethod}
                  disabled={!!editingAccount}
                  onChange={(value) => {
                    if (value === authMethod) return;
                    setAuthMethod(value as AuthMethod);
                    setInput('');
                    setOriginalToken('');
                    setStep('form');
                    setError(null);
                    setPersonalInfo(null);
                    setRtInfo(null);
                    setOauthInfo(null);
                    setOauthRtInfo(null);
                  }}
                  options={[
                    { value: 'apiKey', label: 'OpenAI API Key（官方）' },
                    { value: 'personal', label: 'Personal Access Token' },
                    { value: 'refresh', label: 'Refresh Token' },
                    { value: 'oauth', label: 'OAuth 登录' },
                  ]}
                />
                {isRt && (
                  <p className="mt-1.5 text-caption text-[var(--label)]">
                    Refresh Token 一次性使用，兑换后旧 rt 失效；Team 账号同样支持。
                  </p>
                )}
                {isOauth && (
                  <p className="mt-1.5 text-caption text-[var(--label)]">
                    支持个人与 Team 账号。生成 Codex 登录链接，浏览器登录后自动回跳本机完成认证。
                  </p>
                )}
              </div>

              {isApiKey && (
                <div>
                  <label htmlFor="apiAccountName" className="mb-1.5 block text-label font-medium text-foreground">
                    账号名称 (可选)
                  </label>
                  <Input
                    id="apiAccountName"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="例如：我的 OpenAI API"
                    className="text-body"
                  />
                </div>
              )}

              {!isOauth && (
                <div>
                  <label htmlFor="tokenInput" className="mb-1.5 block text-label font-medium text-foreground">
                    {isApiKey ? 'OpenAI API Key' : isRt ? 'Refresh Token' : 'Personal Access Token'}{' '}
                    <span className="text-destructive">*</span>
                  </label>
                  <Input
                    type={isApiKey ? 'password' : 'text'}
                    autoComplete={isApiKey ? 'new-password' : 'off'}
                    spellCheck={false}
                    id="tokenInput"
                    value={input}
                    onChange={(e) => { setInput(e.target.value); setError(null); }}
                    placeholder={
                      isApiKey
                        ? 'sk-... 或 API Key 登录的 auth.json 内容'
                        : isRt
                          ? '可粘贴 JSON（自动提取 refresh_token）或直接粘贴 rt...'
                          : '在此输入或粘贴 Token...'
                    }
                    className="font-mono text-body"
                  />
                  {!isApiKey && !isRt && isTokenUnchanged && (
                    <p className="mt-1.5 text-caption text-success">
                      Token 未变化，保存将仅更新备注，不会重新获取信息与额度。
                    </p>
                  )}
                </div>
              )}

              <div>
                <label htmlFor="notes" className="mb-1.5 block text-label font-medium text-foreground">
                  备注 (可选)
                </label>
                <Input
                  type="text"
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="例如：这是用于测试环境的临时账号…"
                  className="text-body"
                />
              </div>

              <div className="flex items-start gap-2.5 rounded-[10px] bg-muted/65 p-3 text-label leading-relaxed text-muted-foreground dark:bg-white/[0.04]">
                <Info size={14} className="mt-0.5 shrink-0 text-[var(--label)]" />
                <span>
                  {isApiKey
                    ? '使用 OpenAI 官方 API 额度，按量计费。保存后可手动发送测试消息。'
                    : isOauth
                      ? '登录成功后邮箱与订阅自动解析；限额类型在额度刷新后自动判断。'
                      : isRt
                        ? '邮箱与订阅将从兑换的 Access Token 自动解析；额度将在刷新后自动获取。'
                        : '邮箱与订阅信息将自动从 Token 解析；限额类型（周限/月限）将在额度刷新后自动判断。'}
                </span>
              </div>
            </div>

            {renderFooterButtons(
              isApiKey ? '保存' : isOauth ? '开始 OAuth 登录' : isTokenUnchanged && !isRt ? '保存' : '验证并继续',
              isApiKey ? isSubmitting : isOauth ? isValidating : isTokenUnchanged && !isRt ? isSubmitting : isValidating,
              () => {
                if (isApiKey) void handleConfirmSave();
                else if (isOauth) void handleStartOauth();
                else if (isTokenUnchanged && !isRt) void handleConfirmSave();
                else void handleValidate();
              },
              !isOauth && !input.trim(),
              '取消',
              onClose,
            )}
          </div>
        ) : step === 'oauth' ? (
          <div className="flex flex-col gap-5">
            <div className="space-y-4">
              <div className="flex items-center gap-2.5 text-body text-muted-foreground">
                <LoaderCircle size={14} strokeWidth={2.5} className="animate-spin text-foreground" />
                等待登录回调…（在本机浏览器登录成功后自动完成）
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-label font-medium text-foreground">登录链接</label>
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    readOnly
                    value={oauthInfo?.url || ''}
                    className="font-mono text-caption text-muted-foreground"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={() => void handleCopyUrl()} className="shrink-0">
                    {copied ? '已复制' : '复制'}
                  </Button>
                  <Button type="button" variant="default" size="sm" onClick={() => void handleOpenBrowser()} className="shrink-0">
                    打开浏览器
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-[var(--hairline-divider)]" />
                <span className="text-caption text-[var(--label)]">或</span>
                <div className="h-px flex-1 bg-[var(--hairline-divider)]" />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-label font-medium text-foreground">
                  在其他设备登录后，粘贴浏览器回跳的 localhost 地址
                </label>
                <Input
                  type="text"
                  value={manualUrl}
                  onChange={(e) => { setManualUrl(e.target.value); setError(null); }}
                  placeholder="http://localhost:端口/auth/callback?code=...&state=..."
                  className="font-mono text-caption"
                />
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={() => void handleManualComplete()}
                  disabled={isValidating}
                  className="self-end"
                >
                  {isValidating ? '处理中…' : '完成认证'}
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-[var(--hairline-divider)] pt-3">
              {renderError()}
              <DialogFooter className="pt-0">
                <Button type="button" variant="outline" size="sm" onClick={() => setStep('form')}>
                  返回
                </Button>
              </DialogFooter>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="space-y-3.5">
              <div className="bento-group overflow-hidden">
                <div className="bento-list-row">
                  <span className="text-label text-[var(--label)]">账号邮箱</span>
                  <span className="break-all text-right text-subtitle font-medium text-foreground select-text">
                    {getDisplayedEmail(confirmEmail, isEmailMaskingEnabled)}
                  </span>
                </div>
                <div className="bento-list-row">
                  <span className="text-label text-[var(--label)]">订阅方式</span>
                  <span className="text-subtitle font-medium text-foreground">{confirmPlanLabel}</span>
                </div>
              </div>

              <div className="flex items-start gap-2.5 rounded-[10px] bg-muted/65 p-3 text-label leading-relaxed text-muted-foreground dark:bg-white/[0.04]">
                <Info size={14} className="mt-0.5 shrink-0 text-[var(--label)]" />
                <span>
                  {isEditingOauth
                    ? '确认后将替换此账号的登录凭证，请确认登录的是同一账号。'
                    : isOauth
                      ? '确认后保存账号；登录已成功，Refresh Token 将用于后续自动刷新。'
                      : isRt
                        ? '确认后保存账号；Refresh Token 已一次性消耗，无法重复兑换。'
                        : '确认后保存账号；限额类型（周限/月限）将在额度刷新后根据接口返回自动判断。'}
                </span>
              </div>
            </div>

            {renderFooterButtons(
              isEditingOauth ? '确认替换凭证' : '确认保存',
              isSubmitting,
              () => void handleConfirmSave(),
              !!reauthIdentityError,
              '返回修改',
              () => setStep(isOauth ? 'oauth' : 'form'),
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default AccountModal;
