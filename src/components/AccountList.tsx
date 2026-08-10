import React, { useEffect, useState } from 'react';
import { useAccounts } from '../hooks/useAccounts';
import AccountCard from './AccountCard';
import AccountModal from './AccountModal';
import ConfirmModal from './ConfirmModal';
import TestAccountModal from './TestAccountModal';
import ResetInfoModal from './ResetInfoModal';
import { Account, AccountFormData, AccountUsage } from '../types/account';

interface AccountListProps {
  isEmailMaskingEnabled: boolean;
  usageRevision: number;
  onRefreshUsage: (accountId: string) => Promise<AccountUsage>;
  isUsageRefreshing: (accountId: string) => boolean;
}

const AccountList: React.FC<AccountListProps> = ({
  isEmailMaskingEnabled,
  usageRevision,
  onRefreshUsage,
  isUsageRefreshing,
}) => {
  const { accounts, activeAccountId, isLoading, addAccount, updateAccount, deleteAccount, setActiveAccount, validatePersonalToken, setAccountAccessToken, getResetCredits, refresh } = useAccounts();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [testingAccount, setTestingAccount] = useState<Account | null>(null);
  const [resetAccount, setResetAccount] = useState<Account | null>(null);

  useEffect(() => {
    if (usageRevision > 0) {
      void refresh(false);
    }
  }, [refresh, usageRevision]);

  const handleAdd = () => {
    setEditingAccount(null);
    setIsModalOpen(true);
  };

  const handleEdit = (account: Account) => {
    setEditingAccount(account);
    setIsModalOpen(true);
  };

  const handleSubmit = async (data: AccountFormData, shouldRefreshUsage = true) => {
    let savedAccount: Account;
    if (editingAccount) {
      savedAccount = await updateAccount(editingAccount.id, data);
    } else {
      savedAccount = await addAccount(data);
    }
    setIsModalOpen(false);

    // PAT 未变化时无需重新获取额度
    if (savedAccount.canRefreshUsage && shouldRefreshUsage) {
      void handleRefreshUsage(savedAccount.id, true);
    }
  };

  const handleRefreshUsage = async (accountId: string, accountWasJustSaved = false) => {
    try {
      await onRefreshUsage(accountId);
    } catch (error: any) {
      const prefix = accountWasJustSaved ? '账号已保存，但额度刷新失败' : '额度刷新失败';
      alert(`${prefix}: ${error?.message || error?.toString() || '未知错误'}`);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto w-full">
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="h-6 w-24 bg-[#EAEAEA] rounded animate-pulse mb-2"></div>
            <div className="h-3 w-48 bg-[#F0F0F0] rounded animate-pulse"></div>
          </div>
          <div className="h-8 w-24 bg-[#EAEAEA] rounded-md animate-pulse"></div>
        </div>
        <div className="space-y-3">
          {[1, 2].map(i => (
            <div key={i} className="h-32 bg-white border border-[#EAEAEA] rounded-lg animate-pulse"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto w-full">
      <div className="flex items-center justify-between mb-8 relative z-10">
        <div>
          <h2 className="text-[20px] font-semibold text-black tracking-tight mb-1.5">账号管理</h2>
          <p className="text-[14px] text-[#666666]">管理并无缝切换本地的 Codex 认证配置。</p>
        </div>
        <button
          onClick={handleAdd}
          title="添加账号"
          className="w-8 h-8 flex items-center justify-center bg-black hover:bg-[#333333] text-white rounded-md transition-colors shadow-sm"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
        </button>
      </div>

      {accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 px-8 text-center animate-fade-in bg-gradient-to-b from-white to-[#F8F9FA] border border-[#EAEAEA] rounded-2xl shadow-sm relative overflow-hidden">
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none"></div>
          <div className="w-20 h-20 mb-6 rounded-2xl flex items-center justify-center bg-white shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-[#F0F0F0] relative z-10">
            <div className="absolute inset-0 bg-[#FAFAFA] rounded-2xl"></div>
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#333333] relative z-10"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          </div>
          <h3 className="text-[18px] font-bold text-black mb-2 tracking-tight relative z-10">暂无账号配置</h3>
          <p className="text-[#666666] max-w-[280px] mb-8 text-[14px] leading-relaxed relative z-10">
            你还没有添加任何账号配置。添加一个账号，立即体验 Codex 强大的代码生成能力。
          </p>
          <button
            onClick={handleAdd}
            className="relative z-10 flex items-center gap-2 px-6 py-2.5 bg-black hover:bg-[#333333] text-white font-medium text-[14px] rounded-full transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
            立即创建
          </button>
        </div>
      ) : (
        <div className="h-[464px] overflow-y-auto pr-4 -mr-4 snap-y snap-mandatory">
          <div className="flex flex-col gap-4">
          {accounts.map((account, index) => (
            <div key={account.id} style={{ animationDelay: `${index * 30}ms` }} className="animate-card-in">
              <AccountCard
                account={account}
                isActive={account.id === activeAccountId}
                isEmailMaskingEnabled={isEmailMaskingEnabled}
                onSetActive={async (id) => {
                  try {
                    await setActiveAccount(id);
                  } catch (err: any) {
                    alert(`切换失败: ${err.message || err.toString()}`);
                  }
                }}
                onEdit={handleEdit}
                onDelete={(id) => setDeleteConfirmId(id)}
                onRefreshUsage={(id) => void handleRefreshUsage(id)}
                onTest={(target) => setTestingAccount(target)}
                onShowReset={(target) => setResetAccount(target)}
                isUsageRefreshing={account.canRefreshUsage && isUsageRefreshing(account.id)}
              />
            </div>
          ))}
          </div>
        </div>
      )}

      <AccountModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleSubmit}
        onValidate={validatePersonalToken}
        editingAccount={editingAccount}
      />

      <ConfirmModal
        isOpen={!!deleteConfirmId}
        title="确认删除账号？"
        message="删除后该配置将无法恢复，确定要继续吗？"
        onConfirm={async () => {
          if (deleteConfirmId) {
            try {
              await deleteAccount(deleteConfirmId);
            } catch (err: any) {
              alert(`删除失败: ${err.message || err.toString()}`);
            }
            setDeleteConfirmId(null);
          }
        }}
        onCancel={() => setDeleteConfirmId(null)}
      />

      {testingAccount && (
        <TestAccountModal
          account={testingAccount}
          onClose={() => setTestingAccount(null)}
          onRefreshUsage={onRefreshUsage}
        />
      )}

      {resetAccount && (
        <ResetInfoModal
          account={resetAccount}
          onClose={() => setResetAccount(null)}
          getResetCredits={getResetCredits}
          setAccountAccessToken={setAccountAccessToken}
        />
      )}
    </div>
  );
};

export default AccountList;
