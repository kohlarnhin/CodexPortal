import React, { useState, useEffect } from 'react';
import { Account, AccountFormData, TokenInfo } from '../types/account';

interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: AccountFormData, shouldRefreshUsage?: boolean) => Promise<void>;
  onValidate: (token: string) => Promise<TokenInfo>;
  editingAccount?: Account | null;
}

const PLAN_LABELS: Record<string, string> = {
  team: 'Team',
  plus: 'Plus',
  pro: 'Pro',
  free: 'Free',
};

const AccountModal: React.FC<AccountModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  onValidate,
  editingAccount,
}) => {
  const [tokenInput, setTokenInput] = useState('');
  const [originalToken, setOriginalToken] = useState('');
  const [notes, setNotes] = useState('');
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unsupportedFormat, setUnsupportedFormat] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setStep('form');
    setTokenInfo(null);
    setIsValidating(false);
    setIsSubmitting(false);
    setError(null);

    if (editingAccount) {
      let token = '';
      try {
        const parsed = JSON.parse(editingAccount.authJsonContent);
        if (parsed.personal_access_token) token = parsed.personal_access_token;
      } catch {
        // ignore
      }
      setUnsupportedFormat(!token);
      setOriginalToken(token);
      setTokenInput(token);
      setNotes(editingAccount.notes || '');
    } else {
      setUnsupportedFormat(false);
      setOriginalToken('');
      setTokenInput('');
      setNotes('');
    }
  }, [isOpen, editingAccount]);

  if (!isOpen) return null;

  const handleValidate = async () => {
    setError(null);
    const token = tokenInput.trim();
    if (!token) {
      setError('请输入 Token');
      return;
    }
    setIsValidating(true);
    try {
      const info = await onValidate(token);
      setTokenInfo(info);
      setStep('confirm');
    } catch (err: any) {
      setError(err?.message || err?.toString() || 'Token 校验失败');
    } finally {
      setIsValidating(false);
    }
  };

  const isTokenUnchanged = editingAccount ? tokenInput.trim() === originalToken : false;

  const handleConfirmSave = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      // PAT 未变化时无需重新获取信息/额度（后端仅更新备注）。
      await onSubmit({ token: tokenInput.trim(), notes }, !isTokenUnchanged);
    } catch (err: any) {
      setError(err?.message || err?.toString() || '保存时发生未知错误');
    } finally {
      setIsSubmitting(false);
    }
  };

  const planLabel = tokenInfo
    ? PLAN_LABELS[tokenInfo.chatgptPlanType] || tokenInfo.chatgptPlanType || '未知'
    : '';

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
            <p className="text-[14px] text-[#555555] mb-5">该账号为自定义认证格式，当前暂不支持编辑。<br/>可删除后使用 Personal Access Token 重新添加。</p>
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
                <div className="px-3 py-2 bg-[#F5F5F5] border border-[#EAEAEA] rounded-md text-[13px] text-[#333333] flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    Personal Access Token
                  </span>
                  <span className="text-[11px] text-[#888888]">当前唯一支持</span>
                </div>
                <p className="text-[11px] text-[#999999] mt-1.5">其他认证方式（如自定义 JSON）暂不支持，后续版本开放。</p>
              </div>

              <div>
                <label htmlFor="tokenInput" className="block text-[12px] font-medium text-black mb-1.5">
                  Personal Access Token <span className="text-[#D32F2F]">*</span>
                </label>
                <input
                  type="text"
                  id="tokenInput"
                  value={tokenInput}
                  onChange={(e) => { setTokenInput(e.target.value); setError(null); }}
                  placeholder="在此输入或粘贴 Token..."
                  className="w-full px-3 py-2 bg-white border border-[#EAEAEA] rounded-md focus:border-black focus:ring-1 focus:ring-black outline-none transition-all text-black placeholder-[#A0A0A0] text-[13px] font-mono"
                />
                {isTokenUnchanged && (
                  <p className="mt-1.5 text-[11px] text-emerald-600">
                    Token 未变化，保存将仅更新备注，不会重新获取信息与额度。
                  </p>
                )}
              </div>

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
                <span>邮箱与订阅信息将自动从 Token 解析；限额类型（周限/月限）将在额度刷新后自动判断。</span>
              </div>
            </div>

            {isTokenUnchanged
              ? renderFooterButtons('保存', isSubmitting, () => void handleConfirmSave(), false, '取消', onClose)
              : renderFooterButtons('验证并继续', isValidating, () => void handleValidate(), !tokenInput.trim(), '取消', onClose)}
          </div>
        ) : (
          <div className="flex flex-col max-h-[85vh]">
            <div className="p-5 space-y-4 overflow-y-auto custom-scrollbar flex-1">
              <div className="rounded-xl border border-[#EAEAEA] bg-[#FAFAFA] p-4 space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[12px] text-[#888888] shrink-0">账号邮箱</span>
                  <span className="text-[14px] font-medium text-black select-text break-all text-right">{tokenInfo?.email}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[12px] text-[#888888] shrink-0">订阅方式</span>
                  <span className="text-[14px] font-medium text-black">{planLabel}</span>
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-lg border border-[#EAEAEA] bg-[#F9F9F9] px-3.5 py-2.5 text-[11px] text-[#777777]">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                <span>确认后保存账号；限额类型（周限/月限）将在额度刷新后根据接口返回自动判断。</span>
              </div>
            </div>

            {renderFooterButtons('确认保存', isSubmitting, () => void handleConfirmSave(), false, '返回修改', () => setStep('form'))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AccountModal;
