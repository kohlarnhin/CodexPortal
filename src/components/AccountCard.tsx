import React, { useState } from 'react';
import { Account, AccountUsageWindow } from '../types/account';
import { getDisplayedEmail } from '../utils/accountEmail';
import PlanBadge from './PlanBadge';
import Button from './ui/button';
import { ActionTooltip } from './ui/tooltip';
import {
  formatUsageResetAt,
  formatUsageSyncedAt,
  formatUsageWindowLabel,
  getRemainingPercent,
  getUsageTone,
  USAGE_TONE_FILL,
} from '../utils/accountUsage';
import { ArrowLeftRight, ChartLine, CircleCheck, FileText, LoaderCircle, PenLine, RefreshCw, Trash2, Zap } from 'lucide-react';

interface AccountCardProps {
  account: Account;
  isActive: boolean;
  isEmailMaskingEnabled: boolean;
  onSetActive: (id: string) => void | Promise<void>;
  onEdit: (account: Account) => void;
  onDelete: (id: string) => void;
  onRefreshUsage: (id: string) => void;
  onActivateWindow: (account: Account) => void;
  onShowReset: (account: Account) => void;
  onConfigureAutoSwitch: (account: Account) => void;
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
    <div className="min-w-0 rounded-lg bg-muted/60 px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="truncate text-label text-muted-foreground">
          {formatUsageWindowLabel(window, kind)}
        </span>
        <span className="shrink-0 text-label font-medium text-foreground tabular-nums">
          {remainingPercent === null ? '额度未知' : `剩余 ${Math.round(remainingPercent)}%`}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-primary/10">
        <div
          className={`h-full rounded-full transition-all duration-500 ${progressColor}`}
          style={{ width: `${remainingPercent ?? 0}%` }}
        />
      </div>
      <p className="mt-1.5 truncate text-caption text-muted-foreground">
        {formatUsageResetAt(window.resetsAt)}
      </p>
    </div>
  );
};

const AccountCard: React.FC<AccountCardProps> = ({
  account,
  isActive,
  isEmailMaskingEnabled,
  onSetActive,
  onEdit,
  onDelete,
  onRefreshUsage,
  onActivateWindow,
  onShowReset,
  onConfigureAutoSwitch,
  isUsageRefreshing,
}) => {
  const [isSwitching, setIsSwitching] = useState(false);
  const handleSetActive = async () => {
    setIsSwitching(true);
    try {
      await onSetActive(account.id);
    } finally {
      setIsSwitching(false);
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
    <div className={`@container/card h-full min-h-56 min-w-0 flex flex-col relative bg-card rounded-xl border shadow-xs transition-colors ${
      isActive ? 'border-primary ring-1 ring-inset ring-primary' : ''
    }`}>
      <div className="p-5 flex-1 flex flex-col">
        <div className="flex flex-col items-start justify-between gap-3 mb-4 @min-[560px]/card:flex-row">
          <div className="w-full min-w-0 @min-[560px]/card:flex-1 @min-[560px]/card:w-auto">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="min-w-0 truncate text-title font-semibold text-foreground leading-tight select-text">
                {getDisplayedEmail(account.name, isEmailMaskingEnabled)}
              </h3>
              <PlanBadge planType={account.chatgptPlanType} />
              <ActionTooltip label="查看重置卡详情">
                <button
                  onClick={() => onShowReset(account)}
                  className="shrink-0 px-2 py-0.5 bg-background text-muted-foreground border text-caption font-medium rounded-md hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
                >
                  重置{account.resetCredits ? ` ×${account.resetCredits.availableCount}` : ''}
                </button>
              </ActionTooltip>
            </div>
          </div>
          
          <div className="flex shrink-0 items-center gap-3">
            <div className="flex items-center gap-1">
              <ActionTooltip label={account.canRefreshUsage ? '额度窗口激活（发送测试消息并消耗额度）' : '该账号暂无可用认证'}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onActivateWindow(account)}
                  disabled={!account.canRefreshUsage}
                  aria-label="额度窗口激活"
                >
                  <Zap size={14} />
                </Button>
              </ActionTooltip>
              <ActionTooltip label={account.canRefreshUsage ? (isUsageRefreshing ? '正在刷新额度…' : '刷新额度') : '该账号暂无可用认证'}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onRefreshUsage(account.id)}
                  disabled={!account.canRefreshUsage || isUsageRefreshing}
                  aria-label="刷新额度"
                >
                  <RefreshCw size={14} className={isUsageRefreshing ? 'animate-spin' : ''} />
                </Button>
              </ActionTooltip>
              <ActionTooltip label="编辑账号配置">
                <Button 
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onEdit(account)} 
                  aria-label="编辑账号"
                >
                  <PenLine size={14} />
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
                  <Trash2 size={14} />
                </Button>
              </ActionTooltip>
            </div>
            <div className="w-px h-4 bg-border"></div>
            {isActive ? (
              <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-success/25 bg-success/10 px-2.5 text-label font-medium text-success">
                <CircleCheck size={13} />
                当前使用
              </span>
            ) : (
              <ActionTooltip label={account.canActivate ? '写入 Codex 认证并设为当前账号' : '该账号暂无可用认证，无法切换'}>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2.5 text-label"
                  disabled={!account.canActivate || isSwitching}
                  onClick={() => void handleSetActive()}
                >
                  {isSwitching ? <LoaderCircle size={13} className="animate-spin" /> : <ArrowLeftRight size={13} />}
                  {isSwitching ? '切换中…' : '切换到此'}
                </Button>
              </ActionTooltip>
            )}
          </div>
        </div>

        <div className="mb-4">
          {usageWindows.length > 0 ? (
            <div className={`grid grid-cols-1 gap-3 ${usageWindows.length > 1 ? '@min-[400px]/card:grid-cols-2' : ''}`}>
              {usageWindows.map(({ window, kind }) => (
                <CompactUsageMeter key={kind} window={window} kind={kind} />
              ))}
            </div>
          ) : (
            <div className="flex min-h-[62px] items-center gap-3 rounded-lg bg-muted/60 px-3.5 py-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
                <ChartLine size={13} />
              </div>
              <div className="min-w-0">
                <p className="text-label font-medium text-foreground">
                  {account.canRefreshUsage ? '尚未同步额度' : '暂无可用认证，无法同步额度'}
                </p>
                <p className="mt-0.5 truncate text-caption text-muted-foreground">
                  {account.canRefreshUsage
                    ? '点击刷新按钮获取最新额度'
                    : '请为该账号配置 PAT 或完成 OAuth 登录'}
                </p>
              </div>
            </div>
          )}
        </div>
        
        <div className="flex flex-wrap items-center justify-between gap-y-2 pt-4 border-t mt-auto">
          <div className="flex min-w-0 items-center gap-2 overflow-hidden mr-4">
            <ActionTooltip label="设置剩余额度达到阈值时自动切换账号">
              <Button type="button" variant="outline" size="sm" className="h-6 shrink-0 px-2 text-caption font-normal"
                onClick={() => onConfigureAutoSwitch(account)}>
                <ArrowLeftRight aria-hidden="true" size={12} strokeWidth={1.8} />
                自动切换 ≤ {account.autoSwitchThreshold}%
              </Button>
            </ActionTooltip>
            {account.notes && (
              <>
                <div className="w-5 h-5 shrink-0 rounded-md bg-muted flex items-center justify-center">
                  <FileText size={10} strokeWidth={2.5} className="text-muted-foreground/70" />
                </div>
                <p className="text-label text-muted-foreground truncate">
                  {account.notes}
                </p>
              </>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-caption text-muted-foreground tabular-nums">
              {account.usage
                ? formatUsageSyncedAt(account.usage.syncedAt)
                : `账号更新于 ${new Date(account.updatedAt).toLocaleDateString()}`}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AccountCard;
