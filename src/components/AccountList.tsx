import React, { useEffect, useMemo, useState } from 'react';
import { useAccounts } from '../hooks/useAccounts';
import { useAutoSwitchSettings } from '../hooks/useAutoSwitchSettings';
import AccountCard from './AccountCard';
import AccountModal from './AccountModal';
import AccountAutoSwitchModal from './AccountAutoSwitchModal';
import ConfirmModal from './ConfirmModal';
import QuotaActivationModal from './QuotaActivationModal';
import ResetInfoModal from './ResetInfoModal';
import Button from './ui/button';
import { ActionTooltip } from './ui/tooltip';
import PageHeader from './ui/page-header';
import { Account, AccountFormData, AccountUsage, SaveRtAccountParams } from '../types/account';
import { getDisplayedEmail } from '../utils/accountEmail';
import { FileInput, LoaderCircle, Plus, User } from 'lucide-react';
import { errorMessage, toast } from './ui/toast';

const PLAN_FILTER_LABELS: Record<string, string> = {
  team: 'Team',
  business: 'Business',
  enterprise: 'Enterprise',
  pro: 'Pro',
  plus: 'Plus',
  free: 'Free',
  edu: 'Edu',
};

const filterChipClass = (active: boolean) =>
  `inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-label font-medium transition-colors cursor-pointer ${
    active
      ? 'border-primary bg-primary text-primary-foreground'
      : 'bg-background text-muted-foreground hover:bg-accent hover:text-foreground'
  }`;

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
  const { accounts, activeAccountId, isLoading, addAccount, updateAccount, deleteAccount, setActiveAccount, setAutoSwitchThreshold, importFromAuthJson, validatePersonalToken, exchangeRefreshToken, saveRtAccount, startOauthLogin, checkOauthCallback, completeOauthLogin, setAccountAccessToken, getResetCredits, consumeResetCredit, refresh } = useAccounts();
  const autoSwitch = useAutoSwitchSettings();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [activationAccountId, setActivationAccountId] = useState<string | null>(null);
  const [autoSwitchAccountId, setAutoSwitchAccountId] = useState<string | null>(null);
  const [resetAccount, setResetAccount] = useState<Account | null>(null);
  const [planFilter, setPlanFilter] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const activationAccount = accounts.find((account) => account.id === activationAccountId);
  const autoSwitchAccount = accounts.find((account) => account.id === autoSwitchAccountId);

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

  const handleImportAuthJson = async () => {
    setIsImporting(true);
    try {
      const account = await importFromAuthJson();
      if (account) {
        toast.success(`已导入 ${getDisplayedEmail(account.name, isEmailMaskingEnabled)}`);
        if (account.canRefreshUsage) void handleRefreshUsage(account.id);
      } else {
        toast.info('未找到可导入的登录信息：~/.codex/auth.json 不存在，或其中不是 PAT / Refresh Token 登录。');
      }
    } catch (err) {
      toast.error(errorMessage(err), { title: '导入失败' });
    } finally {
      setIsImporting(false);
    }
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
        <div className="page-header">
          <div>
            <div className="h-6 w-24 bg-muted rounded-md animate-pulse mb-2"></div>
            <div className="h-3.5 w-48 bg-muted rounded-md animate-pulse"></div>
          </div>
          <div className="h-8 w-24 bg-muted rounded-md animate-pulse"></div>
        </div>
        <div className="grid grid-cols-1 @min-[1080px]/page:grid-cols-2 gap-4">
          {[1, 2].map(i => (
            <div key={i} className="h-56 bg-muted/50 rounded-xl animate-pulse"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="page-layout pt-4">
      <PageHeader
        className="relative z-10"
        title="账号管理"
        description="管理并无缝切换本地的 Codex 认证配置。"
        actions={
          <>
            <ActionTooltip label={autoSwitch.enabled ? '关闭自动切换账号' : '开启自动切换账号'}>
              <Button type="button" variant="outline" size="sm" role="switch"
                aria-label="自动切换账号" aria-checked={autoSwitch.enabled === true}
                disabled={autoSwitch.isLoading || autoSwitch.isSaving || autoSwitch.enabled === null}
                onClick={() => void autoSwitch.toggle()} className="gap-2">
                <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${autoSwitch.enabled ? 'bg-success' : 'bg-muted-foreground/40'}`} />
                {autoSwitch.isSaving ? '保存中…' : autoSwitch.isLoading ? '读取设置…'
                  : autoSwitch.enabled === null ? '设置不可用' : autoSwitch.enabled ? '自动切换已开启' : '自动切换已关闭'}
              </Button>
            </ActionTooltip>
            <ActionTooltip label="添加账号">
              <Button onClick={handleAdd} size="sm">
                <Plus size={14} />
                添加账号
              </Button>
            </ActionTooltip>
          </>
        }
      />

      {autoSwitch.error && (
        <div role="alert" className="mb-3 flex shrink-0 items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-label text-destructive">
          <p className="min-w-0 break-words">{autoSwitch.error}</p>
          <Button type="button" variant="ghost" size="sm" disabled={autoSwitch.isLoading || autoSwitch.isSaving}
            onClick={() => void autoSwitch.reload()}>重新读取</Button>
        </div>
      )}

      {accounts.length > 0 && (
        <div className="flex items-center gap-2 mb-3 flex-wrap shrink-0">
          <button
            type="button"
            onClick={() => setPlanFilter(null)}
            className={filterChipClass(planFilter === null)}
          >
            全部
            <span className="opacity-60 tabular-nums">{accounts.length}</span>
          </button>
          {Object.keys(planCounts)
            .sort()
            .map(plan => {
              const label = PLAN_FILTER_LABELS[plan] || plan;
              return (
                <button
                  key={plan}
                  type="button"
                  onClick={() => setPlanFilter(planFilter === plan ? null : plan)}
                  className={filterChipClass(planFilter === plan)}
                >
                  {label}
                  <span className="opacity-60 tabular-nums">{planCounts[plan]}</span>
                </button>
              );
            })}
        </div>
      )}

      {accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed px-8 py-16 text-center animate-fade-in">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <User size={22} />
          </div>
          <h3 className="text-title font-semibold text-foreground">暂无账号配置</h3>
          <p className="mt-1.5 mb-6 max-w-[340px] text-body leading-relaxed text-muted-foreground">
            添加一个账号开始使用；若本机已用 Codex CLI 登录，可直接导入当前登录。
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button onClick={handleAdd} size="sm">
              <Plus size={14} />
              添加账号
            </Button>
            <ActionTooltip label="读取 ~/.codex/auth.json 中的 PAT 或 Refresh Token">
              <Button variant="outline" size="sm" disabled={isImporting} onClick={() => void handleImportAuthJson()}>
                {isImporting ? <LoaderCircle size={14} className="animate-spin" /> : <FileInput size={14} />}
                {isImporting ? '导入中…' : '导入当前 Codex 登录'}
              </Button>
            </ActionTooltip>
          </div>
        </div>
      ) : filteredAccounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed rounded-xl">
          <p className="text-subtitle text-muted-foreground mb-2">该筛选下暂无账号</p>
          <Button
            variant="link"
            onClick={() => setPlanFilter(null)}
            className="text-body font-medium"
          >
            查看全部账号
          </Button>
        </div>
      ) : (
        <div className="page-scroll">
          <div className="grid grid-cols-1 @min-[1080px]/page:grid-cols-2 gap-4 pb-1">
          {filteredAccounts.map((account) => (
            <div key={account.id} className="min-w-0">
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
                    toast.error(errorMessage(err), { title: '切换账号失败' });
                  }
                }}
                onEdit={handleEdit}
                onDelete={(id) => setDeleteConfirmId(id)}
                onRefreshUsage={(id) => void handleRefreshUsage(id)}
                onActivateWindow={(target) => setActivationAccountId(target.id)}
                onShowReset={(target) => setResetAccount(target)}
                onConfigureAutoSwitch={(target) => setAutoSwitchAccountId(target.id)}
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
              toast.error(errorMessage(err), { title: '删除账号失败' });
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

      {autoSwitchAccount && (
        <AccountAutoSwitchModal
          key={autoSwitchAccount.id}
          account={autoSwitchAccount}
          isEmailMaskingEnabled={isEmailMaskingEnabled}
          autoSwitchEnabled={autoSwitch.enabled}
          onClose={() => setAutoSwitchAccountId(null)}
          onSave={setAutoSwitchThreshold}
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
