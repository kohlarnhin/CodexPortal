import React, { useState } from 'react';
import { Account, AccountUsageWindow } from '../types/account';
import { getDisplayedEmail } from '../utils/accountEmail';
import PlanBadge from './PlanBadge';
import { getAccountApiKey, isApiKeyAccount, maskApiKey } from '../utils/accountAuth';
import Button from './ui/button';
import { ActionTooltip } from './ui/tooltip';
import { errorMessage, toast } from './ui/toast';
import { cn } from '../lib/utils';
import {
  formatUsageResetAt,
  formatUsageSyncedAt,
  formatUsageWindowLabel,
  getRemainingPercent,
  getUsageTone,
  USAGE_TONE_FILL,
} from '../utils/accountUsage';
import { ChartLine, FileText, LoaderCircle, PenLine, Power, PowerOff, RefreshCw, Trash2, Zap } from 'lucide-react';

interface AccountCardProps {
  account: Account;
  isActive: boolean;
  isEmailMaskingEnabled: boolean;
  onEdit: (account: Account) => void;
  onSetEnabled: (id: string, enabled: boolean) => Promise<void>;
  onDelete: (id: string) => void;
  onRefreshUsage: (id: string) => void;
  onActivateWindow: (account: Account) => void;
  onShowReset: (account: Account) => void;
  isUsageRefreshing: boolean;
}

const CompactUsageMeter = ({
  window,
  kind,
}: {
  window: AccountUsageWindow;
  kind: 'primary' | 'secondary';
}) => {
  const remainingPercent = getRemainingPercent(window);
  const progressColor = USAGE_TONE_FILL[getUsageTone(remainingPercent)];

  return (
    <div className="min-w-0 rounded-[10px] bg-muted/65 px-3 py-2.5 dark:bg-white/[0.04]">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="truncate text-caption text-[var(--label)]">
          {formatUsageWindowLabel(window, kind)}
        </span>
        <span className="shrink-0 text-label font-semibold text-foreground tabular-nums">
          {remainingPercent === null ? '未知' : `${Math.round(remainingPercent)}%`}
        </span>
      </div>
      <div className="h-[4px] overflow-hidden rounded-full bg-[var(--button-fill)]">
        <div
          className={`h-full rounded-full transition-all duration-500 ${progressColor}`}
          style={{ width: `${remainingPercent ?? 0}%` }}
        />
      </div>
      <p className="mt-1.5 truncate text-[11px] text-[var(--label)]">
        {formatUsageResetAt(window.resetsAt)}
      </p>
    </div>
  );
};

const AccountCard: React.FC<AccountCardProps> = ({
  account,
  isActive,
  isEmailMaskingEnabled,
  onEdit,
  onSetEnabled,
  onDelete,
  onRefreshUsage,
  onActivateWindow,
  onShowReset,
  isUsageRefreshing,
}) => {
  const [isSavingEnabled, setIsSavingEnabled] = useState(false);
  const isApiKey = isApiKeyAccount(account);
  const canSendTest = account.enabled && (isApiKey ? account.canActivate : account.canRefreshUsage);
  const enabledLabel = isUsageRefreshing
    ? '该账号正在刷新，请稍候'
    : account.enabled
      ? '禁用账号'
      : '启用账号';

  const handleToggleEnabled = async () => {
    setIsSavingEnabled(true);
    try {
      await onSetEnabled(account.id, !account.enabled);
    } catch (error) {
      toast.error(errorMessage(error), { title: '账号状态修改失败' });
    } finally {
      setIsSavingEnabled(false);
    }
  };

  const usageWindows: Array<{
    window: AccountUsageWindow;
    kind: 'primary' | 'secondary';
  }> = [];
  if (account.usage?.primary) {
    usageWindows.push({ window: account.usage.primary, kind: 'primary' });
  }
  if (account.usage?.secondary) {
    usageWindows.push({ window: account.usage.secondary, kind: 'secondary' });
  }

  return (
    <div
      className={cn(
        '@container/card bento-card flex h-full min-h-[196px] min-w-0 flex-col overflow-hidden transition-shadow',
        isActive && 'bento-card-selected',
      )}
    >
      <div className="flex flex-1 flex-col px-[18px] pt-4 pb-3.5">
        <div className="mb-3.5 flex flex-col items-start justify-between gap-2.5 @min-[480px]/card:flex-row @min-[480px]/card:items-center">
          <div className="flex w-full min-w-0 items-center gap-2 @min-[480px]/card:w-auto @min-[480px]/card:flex-1">
            {isActive && (
              <span className="bento-status-dot" data-tone="running" title="当前使用中" aria-hidden="true" />
            )}
            <h3
              className={cn(
                'min-w-0 truncate text-[14px] font-semibold tracking-[-0.01em] text-foreground leading-tight select-text',
                !account.enabled && 'opacity-50',
              )}
            >
              {getDisplayedEmail(account.name, isEmailMaskingEnabled)}
            </h3>
            <PlanBadge planType={account.chatgptPlanType} accountType={account.accountType} />
            {!account.enabled && (
              <span className="shrink-0 rounded-full bg-[var(--button-fill)] px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
                已禁用
              </span>
            )}
            {!isApiKey && (
              <ActionTooltip label="查看重置卡详情">
                <button
                  type="button"
                  onClick={() => onShowReset(account)}
                  className="button-neutral shrink-0 cursor-pointer rounded-full px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  重置{account.resetCredits ? ` ×${account.resetCredits.availableCount}` : ''}
                </button>
              </ActionTooltip>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <ActionTooltip label={!account.enabled ? '账号已禁用' : canSendTest ? isApiKey ? '发送 API 测试消息（按量计费）' : '额度窗口激活（发送测试消息并消耗额度）' : '该账号暂无可用认证'}>
              <span className="inline-flex">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onActivateWindow(account)}
                  disabled={!canSendTest}
                  aria-label={isApiKey ? '测试 API Key' : '额度窗口激活'}
                >
                  <Zap size={13.5} />
                </Button>
              </span>
            </ActionTooltip>
            {!isApiKey && (
              <ActionTooltip label={!account.enabled ? '账号已禁用' : account.canRefreshUsage ? (isUsageRefreshing ? '正在刷新额度…' : '刷新额度') : '该账号暂无可用认证'}>
                <span className="inline-flex">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onRefreshUsage(account.id)}
                    disabled={!account.enabled || !account.canRefreshUsage || isUsageRefreshing}
                    aria-label="刷新额度"
                  >
                    <RefreshCw size={13.5} className={isUsageRefreshing ? 'animate-spin' : ''} />
                  </Button>
                </span>
              </ActionTooltip>
            )}
            <ActionTooltip label={enabledLabel}>
              <span className="inline-flex">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={isSavingEnabled || isUsageRefreshing}
                  aria-label={account.enabled ? '禁用账号' : '启用账号'}
                  onClick={() => void handleToggleEnabled()}
                >
                  {isSavingEnabled ? (
                    <LoaderCircle size={13.5} className="animate-spin" />
                  ) : account.enabled ? (
                    <PowerOff size={13.5} />
                  ) : (
                    <Power size={13.5} />
                  )}
                </Button>
              </span>
            </ActionTooltip>
            <ActionTooltip label="编辑账号配置">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onEdit(account)}
                aria-label="编辑账号"
              >
                <PenLine size={13.5} />
              </Button>
            </ActionTooltip>
            <ActionTooltip label="删除账号">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onDelete(account.id)}
                aria-label="删除账号"
                className="hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 size={13.5} />
              </Button>
            </ActionTooltip>
          </div>
        </div>

        <div className={cn('mb-3', !account.enabled && 'opacity-50')}>
          {isApiKey ? (
            <div className="flex min-h-[62px] items-center justify-between gap-3 rounded-[10px] bg-muted/65 px-3.5 py-3 dark:bg-white/[0.04]">
              <div>
                <p className="text-label font-medium text-foreground">官方 API · 按量计费</p>
                <p className="mt-0.5 text-caption text-[var(--label)]">使用 OpenAI Platform 账户额度</p>
              </div>
              <code className="shrink-0 text-caption text-muted-foreground">{maskApiKey(getAccountApiKey(account))}</code>
            </div>
          ) : usageWindows.length > 0 ? (
            <div className={`grid grid-cols-1 gap-2.5 ${usageWindows.length > 1 ? '@min-[360px]/card:grid-cols-2' : ''}`}>
              {usageWindows.map(({ window, kind }) => (
                <CompactUsageMeter key={kind} window={window} kind={kind} />
              ))}
            </div>
          ) : (
            <div className="flex min-h-[62px] items-center gap-3 rounded-[10px] bg-muted/65 px-3.5 py-3 dark:bg-white/[0.04]">
              <div className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-[var(--button-fill)] text-muted-foreground">
                <ChartLine size={13} />
              </div>
              <div className="min-w-0">
                <p className="text-label font-medium text-foreground">
                  {account.canRefreshUsage ? '尚未同步额度' : '暂无可用认证，无法同步额度'}
                </p>
                <p className="mt-0.5 truncate text-caption text-[var(--label)]">
                  {!account.enabled
                    ? '账号已禁用，启用后可刷新额度'
                    : account.canRefreshUsage
                      ? '点击刷新按钮获取最新额度'
                      : '请为该账号配置 PAT 或完成 OAuth 登录'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 border-t border-[var(--hairline-divider)] px-[18px] py-2.5">
        <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
          {account.notes ? (
            <>
              <FileText size={11} className="shrink-0 text-[var(--label)]" aria-hidden="true" />
              <p className={cn('truncate text-caption text-muted-foreground', !account.enabled && 'opacity-50')}>
                {account.notes}
              </p>
            </>
          ) : isActive ? (
            <span className="text-caption font-medium text-foreground">当前使用中</span>
          ) : null}
        </div>
        <span className="shrink-0 text-caption text-[var(--label)] tabular-nums">
          {account.usage
            ? formatUsageSyncedAt(account.usage.syncedAt)
            : `更新于 ${new Date(account.updatedAt).toLocaleDateString()}`}
        </span>
      </div>
    </div>
  );
};

export default AccountCard;
