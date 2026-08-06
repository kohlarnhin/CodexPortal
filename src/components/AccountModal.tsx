import React, { useState, useEffect } from 'react';
import { Account, AccountFormData } from '../types/account';
import Select from './Select';

interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: AccountFormData) => Promise<void>;
  editingAccount?: Account | null;
}

type AuthFormat = 'personal_access_token' | 'raw';

const AccountModal: React.FC<AccountModalProps> = ({ isOpen, onClose, onSubmit, editingAccount }) => {
  const [formData, setFormData] = useState<AccountFormData>({
    name: '',
    authJsonContent: '',
    notes: '',
    planType: 'weekly'
  });
  
  const [formatType, setFormatType] = useState<AuthFormat>('personal_access_token');
  const [tokenInput, setTokenInput] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (editingAccount) {
        let isTokenFormat = false;
        try {
          const parsed = JSON.parse(editingAccount.authJsonContent);
          if (parsed.personal_access_token) {
            setFormatType('personal_access_token');
            setTokenInput(parsed.personal_access_token);
            isTokenFormat = true;
          }
        } catch (e) {
          // ignore
        }

        if (!isTokenFormat) {
          setFormatType('raw');
          setTokenInput('');
        }

        setFormData({
          name: editingAccount.name,
          authJsonContent: editingAccount.authJsonContent,
          notes: editingAccount.notes || '',
          planType: editingAccount.planType || 'weekly'
        });
      } else {
        setFormatType('personal_access_token');
        setTokenInput('');
        setFormData({
          name: '',
          authJsonContent: '',
          notes: '',
          planType: 'weekly'
        });
      }
      setJsonError(null);
      setSubmitError(null);
      setIsSubmitting(false);
    }
  }, [isOpen, editingAccount]);

  if (!isOpen) return null;

  const validateJson = (content: string) => {
    try {
      JSON.parse(content);
      setJsonError(null);
      return true;
    } catch (e) {
      setJsonError('无效的 JSON 格式，请检查');
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    
    let finalAuthJsonContent = formData.authJsonContent;
    
    if (formatType === 'personal_access_token') {
      if (!tokenInput.trim()) {
        setJsonError('请输入 Token');
        return;
      }
      finalAuthJsonContent = JSON.stringify({
        OPENAI_API_KEY: null,
        personal_access_token: tokenInput.trim()
      }, null, 2);
    }

    if (formData.name && finalAuthJsonContent) {
      if (validateJson(finalAuthJsonContent)) {
        setIsSubmitting(true);
        try {
          await onSubmit({
            ...formData,
            authJsonContent: finalAuthJsonContent
          });
        } catch (err: any) {
          setSubmitError(err?.message || err?.toString() || '保存时发生未知错误');
        } finally {
          setIsSubmitting(false);
        }
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (name === 'authJsonContent' && jsonError) {
      setJsonError(null); 
    }
  };

  const handleTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTokenInput(e.target.value);
    setJsonError(null);
  };

  const formatJson = () => {
    if (formatType !== 'raw') return;
    try {
      const parsed = JSON.parse(formData.authJsonContent);
      setFormData(prev => ({ ...prev, authJsonContent: JSON.stringify(parsed, null, 2) }));
      setJsonError(null);
    } catch (e) {
      setJsonError('无法格式化：无效的 JSON');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/20 backdrop-blur-sm animate-fade-in" 
        onClick={onClose}
      ></div>
      
      {/* Modal */}
      <div className="relative w-full max-w-[480px] bg-white rounded-xl shadow-2xl animate-modal-in overflow-hidden flex flex-col border border-[#EAEAEA]">
        <div className="flex justify-between items-center px-5 py-3 border-b border-[#EAEAEA] bg-[#FAFAFA]">
          <h2 className="text-[14px] font-semibold text-black tracking-tight">
            {editingAccount ? '编辑账号配置' : '新增账号配置'}
          </h2>
          <button 
            onClick={onClose}
            className="p-1 text-[#999999] hover:text-black rounded transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 max-h-[85vh]">
          <div className="p-5 space-y-4 overflow-y-auto custom-scrollbar">
            <div>
              <label htmlFor="name" className="block text-[12px] font-medium text-black mb-1.5">
                环境别名 / 账号名称 <span className="text-[#D32F2F]">*</span>
              </label>
              <input
                type="text"
                id="name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="例如：生产环境主账号"
                required
                className="w-full px-3 py-2 bg-white border border-[#EAEAEA] rounded-md focus:border-black focus:ring-1 focus:ring-black outline-none transition-all text-black placeholder-[#A0A0A0] text-[13px]"
              />
            </div>

            <div>
              <label htmlFor="formatType" className="block text-[12px] font-medium text-black mb-1.5">
                认证格式 <span className="text-[#D32F2F]">*</span>
              </label>
              <Select
                value={formatType}
                onChange={(value) => setFormatType(value as AuthFormat)}
                options={[
                  { value: 'personal_access_token', label: 'Personal Access Token (推荐)' },
                  { value: 'raw', label: '自定义 JSON (高级)' }
                ]}
              />
            </div>

            {formatType === 'personal_access_token' ? (
              <div className="animate-fade-in space-y-2">
                <div>
                  <label htmlFor="tokenInput" className="block text-[12px] font-medium text-black mb-1.5">
                    Personal Access Token <span className="text-[#D32F2F]">*</span>
                  </label>
                  <input
                    type="text"
                    id="tokenInput"
                    value={tokenInput}
                    onChange={handleTokenChange}
                    placeholder="在此输入或粘贴 Token..."
                    required
                    className="w-full px-3 py-2 bg-white border border-[#EAEAEA] rounded-md focus:border-black focus:ring-1 focus:ring-black outline-none transition-all text-black placeholder-[#A0A0A0] text-[13px] font-mono"
                  />
                </div>
              </div>
            ) : (
              <div className="animate-fade-in">
                <div className="flex justify-between items-end mb-1.5">
                  <label htmlFor="authJsonContent" className="block text-[12px] font-medium text-black">
                    auth.json 内容 <span className="text-[#D32F2F]">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={formatJson}
                    className="text-[11px] text-[#666666] hover:text-black font-medium"
                  >
                    格式化 JSON
                  </button>
                </div>
                <div className="relative">
                  <textarea
                    id="authJsonContent"
                    name="authJsonContent"
                    value={formData.authJsonContent}
                    onChange={handleChange}
                    placeholder="在此粘贴 auth.json 的完整内容..."
                    required
                    rows={8}
                    className={`w-full p-3 bg-[#0A0A0A] text-[#D4D4D4] font-mono text-[12px] border rounded-md focus:ring-1 outline-none transition-all resize-none custom-scrollbar ${
                      jsonError 
                        ? 'border-[#D32F2F] focus:border-[#D32F2F] focus:ring-[#D32F2F]' 
                        : 'border-[#333333] focus:border-[#666666] focus:ring-[#666666]'
                    }`}
                    spellCheck={false}
                  />
                  {jsonError && (
                    <div className="absolute bottom-3 right-3 flex items-center gap-1.5 px-2 py-1 bg-[#D32F2F] text-white text-[11px] font-medium rounded shadow-sm">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                      {jsonError}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div>
              <label htmlFor="planType" className="block text-[12px] font-medium text-black mb-1.5">
                账号类型 (限额) <span className="text-[#D32F2F]">*</span>
              </label>
              <Select
                value={formData.planType}
                onChange={(value) => setFormData(prev => ({ ...prev, planType: value as 'weekly' | 'monthly' }))}
                options={[
                  { value: 'weekly', label: '周限账号 (包含 5h 与周限制)' },
                  { value: 'monthly', label: '月限账号 (仅包含月限制)' }
                ]}
              />
            </div>

            <div>
              <label htmlFor="notes" className="block text-[12px] font-medium text-black mb-1.5">
                备注 (可选)
              </label>
              <input
                type="text"
                id="notes"
                name="notes"
                value={formData.notes}
                onChange={handleChange}
                placeholder="例如：这是用于测试环境的临时账号..."
                className="w-full px-3 py-2 bg-white border border-[#EAEAEA] rounded-md focus:border-black focus:ring-1 focus:ring-black outline-none transition-all text-black placeholder-[#A0A0A0] text-[13px]"
              />
            </div>
          </div>

          <div className="px-5 py-3 bg-[#FAFAFA] border-t border-[#EAEAEA] flex flex-col gap-3 mt-auto">
            {submitError && (
              <div className="flex items-center gap-1.5 px-3 py-2 bg-[#FFF0F0] border border-[#FFD0D0] text-[#D32F2F] text-[12px] rounded-md selectable">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                <div className="break-all">{submitError}</div>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="px-4 py-1.5 text-[12px] font-medium text-[#333333] bg-white border border-[#EAEAEA] rounded hover:bg-[#F9F9F9] hover:text-black transition-colors shadow-sm disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={
                  isSubmitting ||
                  !formData.name || 
                  (formatType === 'personal_access_token' ? !tokenInput.trim() : !formData.authJsonContent)
                }
                className="px-4 py-1.5 text-[12px] font-medium text-white bg-black border border-transparent rounded hover:bg-[#333333] focus:ring-2 focus:ring-black/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm min-w-[70px] flex justify-center"
              >
                {isSubmitting ? '保存中...' : (editingAccount ? '保存修改' : '确认添加')}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AccountModal;
