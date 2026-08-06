import React from 'react';
import { useAccounts } from '../hooks/useAccounts';
import { getDisplayedEmail } from '../utils/accountEmail';

interface ActiveAccountProps {
  isEmailMaskingEnabled: boolean;
  onNavigateToAccounts: () => void;
}

const LinearProgress = ({ 
  percentage, 
  label, 
  disabled = false,
}: { 
  percentage: number;
  label: string;
  disabled?: boolean;
}) => {
  return (
    <div className={`flex items-center gap-5 ${disabled ? 'opacity-50 grayscale' : ''}`}>
      <div className="w-24 shrink-0 flex items-center gap-2">
        <span className="text-[14px] font-medium text-[#333333] tracking-wide">{label}</span>
      </div>
      
      <div className="flex-1 h-2 bg-[#F0F0F0] rounded-full overflow-hidden">
        <div 
          className={`h-full rounded-full transition-all duration-1000 ease-out ${disabled ? 'bg-[#E0E0E0]' : 'bg-[#10B981]'}`}
          style={{ width: disabled ? '0%' : `${percentage}%` }}
        />
      </div>
      
      <div className="w-20 shrink-0 text-right">
        {disabled ? (
          <span className="text-[12px] font-medium text-[#999999] px-2 py-0.5 bg-[#F5F5F5] rounded">不适用</span>
        ) : (
          <div className="flex items-baseline justify-end gap-1">
            <span className="text-[18px] font-bold text-black font-mono tracking-tight leading-none">{percentage}</span>
            <span className="text-[12px] text-[#666666] font-medium">%</span>
          </div>
        )}
      </div>
    </div>
  );
};

const ActiveAccount: React.FC<ActiveAccountProps> = ({ isEmailMaskingEnabled, onNavigateToAccounts }) => {
  const { accounts, activeAccountId, isLoading } = useAccounts();

  if (isLoading) {
    return <div className="p-8 text-[#666666]">加载中...</div>;
  }

  const activeAccount = accounts.find(a => a.id === activeAccountId);

  if (!activeAccount) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <div className="w-16 h-16 bg-[#F5F5F5] rounded-full flex items-center justify-center mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#999999" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <h2 className="text-[16px] font-medium text-black mb-2">未设置活跃账号</h2>
        <p className="text-[13px] text-[#666666] mb-6 max-w-md">当前没有正在使用的 Codex 账号配置。请前往“账号管理”页面选择或添加一个账号。</p>
        <button 
          onClick={onNavigateToAccounts}
          className="px-5 py-2 bg-black text-white text-[13px] font-medium rounded-md hover:bg-black/80 transition-colors shadow-sm"
        >
          前往账号管理
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto w-full pt-4 h-full flex flex-col">
      <div className="mb-8 shrink-0">
        <h2 className="text-[20px] font-semibold tracking-tight text-black mb-1">当前账号</h2>
        <p className="text-[14px] text-[#666666]">当前正在生效的 Codex 认证配置。</p>
      </div>

      <div className="bg-white border border-[#EAEAEA] rounded-2xl overflow-hidden shadow-sm relative shrink-0">
        <div className="p-8">
          <div className="flex items-center gap-5 mb-10">
            <div className="w-16 h-16 shrink-0 bg-[#F9F9F9] rounded-full flex items-center justify-center border border-[#EAEAEA]">
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#111111" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3 mb-1 min-w-0">
                <h3 className="min-w-0 truncate text-[28px] font-bold font-mono text-black tracking-tight select-text">
                  {getDisplayedEmail(activeAccount.name, isEmailMaskingEnabled)}
                </h3>
                <span className="shrink-0 px-2 py-1 bg-black text-white text-[10px] font-bold rounded-md uppercase tracking-wider">Active</span>
                <span className="shrink-0 px-2 py-1 bg-[#F5F5F5] text-[#666666] border border-[#EAEAEA] text-[10px] font-bold rounded-md uppercase tracking-wider">
                  {activeAccount.planType === 'monthly' ? '月限' : '周限'}
                </span>
              </div>
              <p className="text-[14px] text-[#666666]">{activeAccount.notes || '无备注信息'}</p>
            </div>
          </div>

          <div className="space-y-8">


            <div className="pt-2">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <label className="block text-[13px] font-semibold text-black uppercase tracking-wider">使用情况与限制</label>
                  <span className="text-[11px] font-medium text-blue-600 bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-100 flex items-center gap-1 shadow-sm">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                    可用重置：3 次
                  </span>
                </div>
                <span className="text-[11px] font-medium text-[#888888] bg-[#F5F5F5] px-2 py-0.5 rounded-full border border-[#EAEAEA]">Mock Data</span>
              </div>
              
              <div className="bg-white border border-[#EAEAEA] rounded-xl p-6 shadow-sm flex flex-col gap-6">
                <LinearProgress 
                  percentage={66} 
                  label="5h 限制" 
                  disabled={activeAccount.planType === 'monthly'} 
                />
                <LinearProgress 
                  percentage={62} 
                  label="周限制" 
                  disabled={activeAccount.planType === 'monthly'} 
                />
                <LinearProgress 
                  percentage={20} 
                  label="月限制" 
                  disabled={activeAccount.planType === 'weekly'} 
                />
              </div>

              {activeAccount.planType === 'weekly' && (
                <div className="mt-6 flex items-center gap-3 bg-[#FAFAFA] px-4 py-3.5 rounded-xl border border-[#EAEAEA]">
                  <div className="w-7 h-7 rounded-full bg-white border border-[#EAEAEA] flex items-center justify-center shadow-sm shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#333]"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  </div>
                  <div className="text-[13px] text-[#555555]">
                    下一次额度重置：<span className="font-bold text-black">5h 限制</span> 将在 <span className="font-bold text-black bg-white px-2 py-1 rounded-md border border-[#EAEAEA] mx-1 shadow-sm">2小时 15分钟</span> 后刷新。
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ActiveAccount;
