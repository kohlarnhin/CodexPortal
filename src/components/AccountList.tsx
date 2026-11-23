import React, { useEffect, useMemo, useState } from 'react';
import { useAccounts } from '../hooks/useAccounts';
import AccountCard from './AccountCard';
import AccountModal from './AccountModal';
import SchedulePreview from './SchedulePreview';
import ConfirmModal from './ConfirmModal';
import QuotaActivationModal from './QuotaActivationModal';
import ResetInfoModal from './ResetInfoModal';
import Button from './ui/button';
import { ActionTooltip } from './ui/tooltip';
import PageHeader from './ui/page-header';
import Select from './Select';
import { Account, AccountFormData, AccountUsage, SaveApiKeyAccountParams, SaveRtAccountParams } from '../types/account';
import { isApiKeyAccount } from '../utils/accountAuth';
import { getDisplayedEmail } from '../utils/accountEmail';
import { AccountSortField, DEFAULT_SORT_DIRECTIONS, readAccountSort, saveAccountSort, sortAccounts } from '../utils/accountSort';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, FileInput, LoaderCircle, Plus, User } from 'lucide-react';
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
  `inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors cursor-pointer ${
    active
      ? 'bg-primary text-primary-foreground'
      : 'button-neutral text-muted-foreground hover:text-foreground'
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
  const { accounts, activeAccountId, isLoading, addAccount, updateAccount, deleteAccount, setAccountEnabled, updateAccountNotes, reauthOauthAccount, importFromAuthJson, validatePersonalToken, exchangeRefreshToken, saveRtAccount, saveApiKeyAccount, startOauthLogin, checkOauthCallback, completeOauthLogin, setAccountAccessToken, getResetCredits, consumeResetCredit, refresh } = useAccounts();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [activationAccountId, setActivationAccountId] = useState<string | null>(null);
  const [resetAccount, setResetAccount] = useState<Account | null>(null);
  const [planFilter, setPlanFilter] = useState<string | null>(null);
  const [authFilter, setAuthFilter] = useState<Account['authMethod'] | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [sort, setSort] = useState(readAccountSort);
  const [isImporting, setIsImporting] = useState(false);
  const activationAccount = accounts.find((account) => account.id === activationAccountId);

  const eligibleAccounts = useMemo(() => accounts.filter(account =>
    (authFilter === 'all' || account.authMethod === authFilter)
      && (statusFilter === 'all' || account.enabled === (statusFilter === 'enabled')),
  ), [accounts, authFilter, statusFilter]);

  const planCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const account of eligibleAccounts) {
      if (isApiKeyAccount(account)) continue;
      const plan = (account.chatgptPlanType || '').toLowerCase();
      if (plan) counts[plan] = (counts[plan] || 0) + 1;
    }
    if (planFilter && counts[planFilter] === undefined) counts[planFilter] = 0;
    return counts;
  }, [eligibleAccounts, planFilter]);

  const filteredAccounts = useMemo(
    () => sortAccounts(planFilter
      ? eligibleAccounts.filter(account => !isApiKeyAccount(account) && (account.chatgptPlanType || '').toLowerCase() === planFilter)
      : eligibleAccounts, sort),
    [eligibleAccounts, planFilter, sort],
  );

  useEffect(() => { saveAccountSort(sort); }, [sort]);

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

    if (savedAccount.enabled && savedAccount.canRefreshUsage && shouldRefreshUsage) {
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

  const handleSaveApiKey = async (params: SaveApiKeyAccountParams): Promise<Account> => {
    const account = await saveApiKeyAccount(params);
    setIsModalOpen(false);
    return account;
  };

  const handleReauthOauth = async (id: string, params: SaveRtAccountParams): Promise<Account> => {
    const account = await reauthOauthAccount(id, params);
    setIsModalOpen(false);
    toast.success('账号凭证已更新');
    return account;
  };

  const handleImportAuthJson = async () => {
    setIsImporting(true);
    try {
      const account = await importFromAuthJson();
      if (account) {
        toast.success(`已导入 ${getDisplayedEmail(account.name, isEmailMaskingEnabled)}`);
        if (account.canRefreshUsage) void handleRefreshUsage(account.id);
      } else {
        toast.info('未找到可导入的登录信息：支持本机 Codex 的 API Key、PAT 或 Refresh Token 登录。');
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
      // 后端已记录异常
    }
  };

  if (isLoading) {
    return (
      <div className="page-layout">
        <div className="page-header">
          <div className="h-6 w-24 rounded-md bg-[var(--button-fill)] animate-pulse" />
          <div className="h-8 w-24 rounded-full bg-[var(--button-fill)] animate-pulse" />
        </div>
        <div className="page-body">
          <div className="grid grid-cols-1 @min-[820px]/page:grid-cols-2 gap-3.5">
            {[1, 2].map(i => (
              <div key={i} className="h-52 rounded-[14px] bg-[var(--button-fill)]/70 animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-layout">
      <PageHeader
        className="relative z-10"
        title="账号管理"
        badge={
          <SchedulePreview
            accounts={accounts}
            isEmailMaskingEnabled={isEmailMaskingEnabled}
            className="max-w-[340px]"
          />
        }
        actions={
          <Button onClick={handleAdd} size="sm">
            <Plus size={14} />
            添加账号
          </Button>
        }
      />

      {accounts.length > 0 && (
        <div className="relative z-20 mb-3.5 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2.5 px-[var(--workspace-inset-inline)]">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPlanFilter(null)}
              className={filterChipClass(planFilter === null)}
            >
              全部
              <span className="opacity-65 tabular-nums">{eligibleAccounts.length}</span>
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
                    <span className="opacity-65 tabular-nums">{planCounts[plan]}</span>
                  </button>
                );
              })}
          </div>

          <div className="ml-auto flex flex-wrap items-center justify-end gap-x-2.5 gap-y-2">
            <div className="flex items-center gap-1.5">
              <span className="text-caption text-[var(--label)]">认证</span>
              <Select
                value={authFilter}
                onChange={value => setAuthFilter(value as typeof authFilter)}
                align="right"
                className="w-[104px]"
                options={[
                  { value: 'all', label: '全部认证' },
                  { value: 'api_key', label: 'API Key' },
                  { value: 'pat', label: 'PAT' },
                  { value: 'oauth', label: 'OAuth' },
                ]}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-caption text-[var(--label)]">状态</span>
              <Select
                value={statusFilter}
                onChange={value => setStatusFilter(value as typeof statusFilter)}
                align="right"
                className="w-[96px]"
                options={[
                  { value: 'all', label: '全部状态' },
                  { value: 'enabled', label: '已启用' },
                  { value: 'disabled', label: '已禁用' },
                ]}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-caption text-[var(--label)]">排序</span>
              <Select
                value={sort.field}
                onChange={value => {
                  const field = value as AccountSortField;
                  setSort({ field, direction: DEFAULT_SORT_DIRECTIONS[field] });
                }}
                align="right"
                className="w-[104px]"
                options={[
                  { value: 'default', label: '默认' },
                  { value: 'remaining', label: '剩余额度' },
                  { value: 'reset', label: '重置时间' },
                  { value: 'name', label: '名称' },
                  { value: 'created', label: '添加时间' },
                ]}
              />
              {sort.field !== 'default' && (
                <ActionTooltip label={sort.direction === 'asc' ? '升序，点击改为降序' : '降序，点击改为升序'}>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-9"
                    aria-label={sort.direction === 'asc' ? '改为降序' : '改为升序'}
                    onClick={() => setSort(current => ({ ...current, direction: current.direction === 'asc' ? 'desc' : 'asc' }))}
                  >
                    {sort.direction === 'asc' ? <ArrowUpNarrowWide size={14} /> : <ArrowDownWideNarrow size={14} />}
                  </Button>
                </ActionTooltip>
              )}
            </div>
          </div>
        </div>
      )}

      {accounts.length === 0 ? (
        <div className="page-body">
          <div className="bento-empty flex-1 animate-fade-in">
            <div className="mb-3.5 grid size-11 place-items-center rounded-[12px] bg-[var(--button-fill)] text-muted-foreground">
              <User size={20} />
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
              <ActionTooltip label="读取本机 auth.json 中的 API Key、PAT 或 Refresh Token">
                <Button variant="outline" size="sm" disabled={isImporting} onClick={() => void handleImportAuthJson()}>
                  {isImporting ? <LoaderCircle size={14} className="animate-spin" /> : <FileInput size={14} />}
                  {isImporting ? '导入中…' : '导入当前 Codex 登录'}
                </Button>
              </ActionTooltip>
            </div>
          </div>
        </div>
      ) : filteredAccounts.length === 0 ? (
        <div className="page-body">
          <div className="bento-empty flex-1">
            <p className="text-subtitle text-muted-foreground mb-2">该筛选下暂无账号</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setPlanFilter(null); setAuthFilter('all'); setStatusFilter('all'); }}
            >
              查看全部账号
            </Button>
          </div>
        </div>
      ) : (
        <div className="page-scroll">
          <div className="grid grid-cols-1 @min-[820px]/page:grid-cols-2 gap-3.5 pb-1">
            {filteredAccounts.map((account) => (
              <div key={account.id} className="min-w-0">
                <AccountCard
                  account={account}
                  isActive={account.id === activeAccountId}
                  isEmailMaskingEnabled={isEmailMaskingEnabled}
                  onEdit={handleEdit}
                  onSetEnabled={setAccountEnabled}
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
        onSaveApiKey={handleSaveApiKey}
        onSaveNotes={updateAccountNotes}
        onReauthOauth={handleReauthOauth}
        onStartOauth={startOauthLogin}
        onCheckOauth={checkOauthCallback}
        onCompleteOauth={completeOauthLogin}
        editingAccount={editingAccount}
        isEmailMaskingEnabled={isEmailMaskingEnabled}
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

      {resetAccount && (
        <ResetInfoModal
          account={resetAccount}
          onClose={() => setResetAccount(null)}
          getResetCredits={getResetCredits}
          setAccountAccessToken={setAccountAccessToken}
          consumeResetCredit={consumeResetCredit}
        />
      )}
    </div>
  );
};

export default AccountList;
