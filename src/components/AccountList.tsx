import React, { useEffect, useMemo, useState } from 'react';
import { useAccounts } from '../hooks/useAccounts';
import AccountCard from './AccountCard';
import AccountModal from './AccountModal';
import ConfirmModal from './ConfirmModal';
import QuotaActivationModal from './QuotaActivationModal';
import ResetInfoModal from './ResetInfoModal';
import Button from './ui/button';
import { ActionTooltip } from './ui/tooltip';
import { Account, AccountFormData, AccountUsage, SaveRtAccountParams } from '../types/account';

const PLAN_FILTER_STYLES: Record<string, { label: string; activeClass: string }> = {
  team: { label: 'Team', activeClass: 'bg-black text-white border-black' },
  business: { label: 'Business', activeClass: 'bg-black text-white border-black' },
  enterprise: { label: 'Enterprise', activeClass: 'bg-black text-white border-black' },
  pro: { label: 'Pro', activeClass: 'bg-[#B45309] text-white border-[#B45309]' },
  plus: { label: 'Plus', activeClass: 'bg-[#2563EB] text-white border-[#2563EB]' },
  free: { label: 'Free', activeClass: 'bg-[#888888] text-white border-[#888888]' },
  edu: { label: 'Edu', activeClass: 'bg-emerald-600 text-white border-emerald-600' },
};

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
  const { accounts, activeAccountId, isLoading, addAccount, updateAccount, deleteAccount, setActiveAccount, validatePersonalToken, exchangeRefreshToken, saveRtAccount, startOauthLogin, checkOauthCallback, completeOauthLogin, setAccountAccessToken, getResetCredits, consumeResetCredit, refresh } = useAccounts();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [activationAccountId, setActivationAccountId] = useState<string | null>(null);
  const [resetAccount, setResetAccount] = useState<Account | null>(null);
  const [planFilter, setPlanFilter] = useState<string | null>(null);
  const activationAccount = accounts.find((account) => account.id === activationAccountId);

  // 各订阅类型的账号数量（用于筛选 chip）
  const planCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const account of accounts) {
      const plan = (account.chatgptPlanType || '').toLowerCase();
      if (plan) counts[plan] = (counts[plan] || 0) + 1;
    }
    return counts;
  }, [accounts]);

  const filteredAccounts = useMemo(
    () => (planFilter ? accounts.filter(a => (a.chatgptPlanType || '').toLowerCase() === planFilter) : accounts),
    [accounts, planFilter],
  );

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
      void handleRefreshUsage(savedAccount.id);
    }
  };

  const handleSaveRt = async (params: SaveRtAccountParams): Promise<Account> => {
    const savedAccount = await saveRtAccount(params);
    setIsModalOpen(false);
    if (savedAccount.canRefreshUsage) {
      void handleRefreshUsage(savedAccount.id);
    }
    return savedAccount;
  };

  const handleRefreshUsage = async (accountId: string) => {
    try {
      await onRefreshUsage(accountId);
    } catch {
      // 后端已记录异常，由全局弹窗统一展示。
    }
  };

  if (isLoading) {
    return (
      <div className="page-layout pt-4">
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
    <div className="page-layout pt-4">
      <div className="page-header relative z-10 mb-3">
        <div>
          <h2 className="text-[20px] font-semibold text-black tracking-tight mb-1">账号管理</h2>
          <p className="text-[13px] text-[#666666]">管理并无缝切换本地的 Codex 认证配置。</p>
        </div>
        <ActionTooltip label="添加账号">
          <Button
            onClick={handleAdd}
            size="icon"
            className="h-8 w-8 shadow-sm"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
          </Button>
        </ActionTooltip>
      </div>

      {accounts.length > 0 && (
        <div className="flex items-center gap-2 mb-3 flex-wrap shrink-0">
          <button
            type="button"
            onClick={() => setPlanFilter(null)}
            className={`px-3 py-1 rounded-full border text-[12px] font-medium transition-all cursor-pointer ${
              planFilter === null
                ? 'bg-black text-white border-black shadow-2xs'
                : 'bg-white text-[#666666] border-[#EAEAEA] hover:border-[#CCCCCC] hover:text-black'
            }`}
          >
            全部
          </button>
          {Object.keys(planCounts)
            .sort()
            .map(plan => {
              const meta = PLAN_FILTER_STYLES[plan];
              const label = meta?.label || plan;
              return (
                <button
                  key={plan}
                  type="button"
                  onClick={() => setPlanFilter(planFilter === plan ? null : plan)}
                  className={`px-3 py-1 rounded-full border text-[12px] font-medium transition-all cursor-pointer ${
                    planFilter === plan
                      ? (meta?.activeClass || 'bg-black text-white border-black') + ' shadow-2xs'
                      : 'bg-white text-[#666666] border-[#EAEAEA] hover:border-[#CCCCCC] hover:text-black'
                  }`}
                >
                  {label}
                  <span className="ml-1 opacity-60">{planCounts[plan]}</span>
                </button>
              );
            })}
        </div>
      )}

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
          <Button
            onClick={handleAdd}
            className="relative z-10 gap-2 px-6 py-2.5 rounded-full shadow-md hover:shadow-lg"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
            立即创建
          </Button>
        </div>
      ) : filteredAccounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-[#DADADA] bg-white rounded-2xl">
          <p className="text-[14px] text-[#666666] mb-2">该筛选下暂无账号</p>
          <Button
            variant="link"
            onClick={() => setPlanFilter(null)}
            className="text-[13px] font-medium"
          >
            查看全部账号
          </Button>
        </div>
      ) : (
        <div className="page-scroll">
          <div className="grid grid-cols-1 @min-[1080px]/page:grid-cols-2 gap-4 pb-1">
          {filteredAccounts.map((account, index) => (
            <div key={account.id} style={{ animationDelay: `${index * 30}ms` }} className="min-w-0 animate-card-in">
              <AccountCard
                account={account}
                isActive={account.id === activeAccountId}
                isEmailMaskingEnabled={isEmailMaskingEnabled}
                onSetActive={async (id) => {
                  try {
                    await setActiveAccount(id);
                    // 切换成功后自动刷新新账号的剩余额度。
                    void handleRefreshUsage(id);
                  } catch (err: any) {
                    alert(`切换失败: ${err.message || err.toString()}`);
                  }
                }}
                onEdit={handleEdit}
                onDelete={(id) => setDeleteConfirmId(id)}
                onRefreshUsage={(id) => void handleRefreshUsage(id)}
                onActivateWindow={(target) => setActivationAccountId(target.id)}
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
        onExchangeRt={exchangeRefreshToken}
        onSaveRt={handleSaveRt}
        onStartOauth={startOauthLogin}
        onCheckOauth={checkOauthCallback}
        onCompleteOauth={completeOauthLogin}
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

      {activationAccount && (
        <QuotaActivationModal
          key={activationAccount.id}
          account={activationAccount}
          onClose={() => setActivationAccountId(null)}
          isUsageRefreshing={isUsageRefreshing(activationAccount.id)}
          isEmailMaskingEnabled={isEmailMaskingEnabled}
        />
      )}

      {resetAccount && (
        <ResetInfoModal
          account={resetAccount}
          onClose={() => setResetAccount(null)}
          getResetCredits={getResetCredits}
          setAccountAccessToken={setAccountAccessToken}
          consumeResetCredit={consumeResetCredit}
          onRefreshUsage={handleRefreshUsage}
        />
      )}
    </div>
  );
};

export default AccountList;
