import React from 'react';
import { Account, AccountUsageWindow } from '../types/account';
import { getDisplayedEmail } from '../utils/accountEmail';
import PlanBadge from './PlanBadge';
import Button from './ui/button';
import { ActionTooltip } from './ui/tooltip';
import ToggleSwitch from './ToggleSwitch';
import {
  formatUsageResetAt,
  formatUsageSyncedAt,
  formatUsageWindowLabel,
  getRemainingPercent,
} from '../utils/accountUsage';

interface AccountCardProps {
  account: Account;
  isActive: boolean;
  isEmailMaskingEnabled: boolean;
  onSetActive: (id: string) => void;
  onEdit: (account: Account) => void;
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
  const progressColor = remainingPercent === null ? 'bg-[#E0E0E0]' : remainingPercent <= 20
    ? 'bg-[#EF4444]'
    : remainingPercent <= 50
      ? 'bg-[#F59E0B]'
      : 'bg-[#10B981]';

  return (
    <div className="min-w-0 rounded-lg border border-[#EAEAEA] bg-[#FAFAFA] px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="truncate text-[11px] font-semibold text-[#444444]">
          {formatUsageWindowLabel(window, kind)}
        </span>
        <span className="shrink-0 font-mono text-[12px] font-bold text-black">
          {remainingPercent === null ? '额度未知' : `剩余 ${Math.round(remainingPercent)}%`}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#EAEAEA]">
        <div
          className={`h-full rounded-full transition-all duration-500 ${progressColor}`}
          style={{ width: `${remainingPercent ?? 0}%` }}
        />
      </div>
      <p className="mt-1.5 truncate text-[10px] text-[#888888]">
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
  isUsageRefreshing,
}) => {
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
    <div className={`@container/card h-full min-h-56 min-w-0 flex flex-col relative bg-white rounded-xl border-2 transition-all duration-200 ${
      isActive ? 'border-black' : 'border-[#EAEAEA] hover:border-[#D0D0D0]'
    }`}>
      <div className="p-5 flex-1 flex flex-col">
        <div className="flex flex-col items-start justify-between gap-3 mb-4 @min-[560px]/card:flex-row">
          <div className="w-full min-w-0 @min-[560px]/card:flex-1 @min-[560px]/card:w-auto">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="min-w-0 truncate text-[16px] font-bold font-mono text-black leading-tight select-text">
                {getDisplayedEmail(account.name, isEmailMaskingEnabled)}
              </h3>
              <PlanBadge planType={account.chatgptPlanType} />
              <ActionTooltip label="查看重置卡详情">
                <button
                  onClick={() => onShowReset(account)}
                  className="shrink-0 px-2 py-0.5 bg-[#F5F5F5] text-[#555555] border border-[#E5E5E5] text-[10px] font-medium rounded-full hover:border-black/30 hover:text-black transition-all cursor-pointer shadow-2xs"
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
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>
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
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={isUsageRefreshing ? 'animate-spin' : ''}
                  >
                    <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5" />
                    <path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" />
                  </svg>
                </Button>
              </ActionTooltip>
              <ActionTooltip label="编辑账号配置">
                <Button 
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onEdit(account)} 
                  aria-label="编辑账号"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                </Button>
              </ActionTooltip>
              <ActionTooltip label="删除账号">
                <Button 
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onDelete(account.id)} 
                  aria-label="删除账号"
                  className="hover:bg-red-50 hover:text-red-600"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                </Button>
              </ActionTooltip>
            </div>
            <div className="w-[1px] h-4 bg-[#EAEAEA]"></div>
            <div className="flex items-center">
              <ToggleSwitch
                label="切换当前账号"
                checked={isActive}
                disabled={!account.canActivate}
                onToggle={() => {
                  if (!isActive) onSetActive(account.id);
                }}
              />
            </div>
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
            <div className="flex min-h-[62px] items-center gap-3 rounded-lg border border-dashed border-[#DADADA] bg-[#FAFAFA] px-3.5 py-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#EAEAEA] bg-white text-[#777777]">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="m7 16 4-5 4 3 4-7"/></svg>
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-[#555555]">
                  {account.canRefreshUsage ? '尚未同步额度' : '暂无可用认证，无法同步额度'}
                </p>
                <p className="mt-0.5 truncate text-[10px] text-[#999999]">
                  {account.canRefreshUsage
                    ? '点击刷新按钮获取最新额度'
                    : '请为该账号配置 PAT 或完成 OAuth 登录'}
                </p>
              </div>
            </div>
          )}
        </div>
        
        <div className="flex flex-wrap items-center justify-between gap-y-2 pt-4 border-t border-[#EAEAEA] mt-auto">
          <div className="flex items-center gap-2 overflow-hidden mr-4">
            {account.notes && (
              <>
                <div className="w-5 h-5 shrink-0 rounded bg-[#F5F5F5] flex items-center justify-center border border-[#EAEAEA]">
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#999999]"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>
                </div>
                <p className="text-[12px] text-[#666666] truncate">
                  {account.notes}
                </p>
              </>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-[11px] text-[#999999] font-mono">
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
