import React from 'react';
import { Account, AccountUsageWindow } from '../types/account';
import { getDisplayedEmail } from '../utils/accountEmail';
import PlanBadge from './PlanBadge';
import {
  formatNextRefreshAt,
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
  onTest: (account: Account) => void;
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
  const progressColor = remainingPercent <= 20
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
          剩余 {Math.round(remainingPercent)}%
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#EAEAEA]">
        <div
          className={`h-full rounded-full transition-all duration-500 ${progressColor}`}
          style={{ width: `${remainingPercent}%` }}
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
  onTest,
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
    <div className={`snap-start flex flex-col relative bg-white rounded-xl border-2 transition-all duration-200 ${
      isActive ? 'border-black' : 'border-[#EAEAEA] hover:border-[#D0D0D0]'
    }`}>
      <div className="p-5 flex-1 flex flex-col">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1 min-w-0 mr-4">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="min-w-0 truncate text-[16px] font-bold font-mono text-black leading-tight select-text">
                {getDisplayedEmail(account.name, isEmailMaskingEnabled)}
              </h3>
              <PlanBadge planType={account.chatgptPlanType} />
              <button
                onClick={() => onShowReset(account)}
                title="查看重置卡"
                className="shrink-0 px-1.5 py-0.5 bg-[#F5F5F5] text-[#666666] border border-[#EAEAEA] text-[9px] font-bold rounded uppercase tracking-wider hover:border-black hover:text-black transition-colors"
              >
                重置{account.resetCredits ? ` ×${account.resetCredits.availableCount}` : ''}
              </button>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => onTest(account)}
                disabled={!account.canRefreshUsage}
                title={account.canRefreshUsage ? '测试额度（调用模型接口）' : '仅 Personal Access Token 账号支持额度测试'}
                aria-label="测试额度"
                className="w-7 h-7 flex items-center justify-center rounded text-[#888888] hover:bg-[#F5F5F5] hover:text-black transition-all disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>
              </button>
              <button
                onClick={() => onRefreshUsage(account.id)}
                disabled={!account.canRefreshUsage || isUsageRefreshing}
                title={account.canRefreshUsage ? '刷新额度' : '仅 Personal Access Token 账号支持额度刷新'}
                aria-label="刷新额度"
                className="w-7 h-7 flex items-center justify-center rounded text-[#888888] hover:bg-[#F5F5F5] hover:text-black transition-all disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={isUsageRefreshing ? 'animate-spin' : ''}
                >
                  <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5" />
                  <path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" />
                </svg>
              </button>
              <button 
                onClick={() => onEdit(account)} 
                title="编辑账号"
                className="w-7 h-7 flex items-center justify-center rounded text-[#888888] hover:bg-[#F5F5F5] hover:text-black transition-all"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
              </button>
              <button 
                onClick={() => onDelete(account.id)} 
                title="删除账号"
                className="w-7 h-7 flex items-center justify-center rounded text-[#888888] hover:bg-[#FFF0F0] hover:text-[#D32F2F] transition-all"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
              </button>
            </div>
            <div className="w-[1px] h-4 bg-[#EAEAEA]"></div>
            <div className="flex items-center gap-2">
              <div 
                onClick={() => {
                  if (!isActive) onSetActive(account.id);
                }}
                className={`relative inline-block w-10 h-5 rounded-full transition-colors duration-200 ease-in-out cursor-pointer ${
                  isActive ? 'bg-black' : 'bg-[#E0E0E0] hover:bg-[#D0D0D0]'
                }`}
              >
                <span className={`absolute left-[2px] top-[2px] bg-white w-4 h-4 rounded-full shadow-sm transform transition-transform duration-200 ease-in-out ${
                  isActive ? 'translate-x-5' : 'translate-x-0'
                }`} />
              </div>
            </div>
          </div>
        </div>

        <div className="mb-4">
          {usageWindows.length > 0 ? (
            <div className={`grid gap-3 ${usageWindows.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
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
                  {account.canRefreshUsage ? '尚未同步额度' : '暂不支持额度同步'}
                </p>
                <p className="mt-0.5 truncate text-[10px] text-[#999999]">
                  {account.canRefreshUsage
                    ? '点击刷新按钮获取最新额度'
                    : '仅 Personal Access Token 账号支持'}
                </p>
              </div>
            </div>
          )}
        </div>
        
        <div className="flex items-center justify-between pt-4 border-t border-[#EAEAEA] mt-auto">
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
            {account.usage && (
              <span className="rounded-full border border-[#EAEAEA] bg-[#FAFAFA] px-2 py-0.5 text-[10px] font-medium text-[#666666]">
                {formatNextRefreshAt(account.nextRefreshAt, account.usage)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AccountCard;
