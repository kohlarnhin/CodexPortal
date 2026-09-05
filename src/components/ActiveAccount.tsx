import React, { useEffect, useRef, useState } from 'react';
import { useAccounts } from '../hooks/useAccounts';
import { getDisplayedEmail } from '../utils/accountEmail';
import PlanBadge from './PlanBadge';
import { AccountUsage, AccountUsageWindow } from '../types/account';
import {
  formatUsageResetAt,
  formatUsageSyncedAt,
  formatUsageWindowLabel,
  getRemainingPercent,
} from '../utils/accountUsage';

interface ActiveAccountProps {
  isEmailMaskingEnabled: boolean;
  onNavigateToAccounts: () => void;
  usageRevision: number;
  onRefreshUsage: (accountId: string) => Promise<AccountUsage>;
  isUsageRefreshing: (accountId: string) => boolean;
}

const UsageOverview = ({
  window,
  kind,
  separated,
}: {
  window: AccountUsageWindow;
  kind: 'primary' | 'secondary';
  separated: boolean;
}) => {
  const remainingPercent = getRemainingPercent(window);
  const label = formatUsageWindowLabel(window, kind);
  const progressColor = remainingPercent <= 20
    ? 'bg-[#EF4444]'
    : remainingPercent <= 50
      ? 'bg-[#F59E0B]'
      : 'bg-[#10B981]';
  const status = remainingPercent === 0 ? '额度已用尽' : remainingPercent <= 20 ? '余量偏低' : null;

  return (
    <div className={`min-w-0 px-6 py-6 @min-[520px]:px-7 @min-[520px]:py-7 ${separated ? 'border-t border-[#EAEAEA] @min-[520px]:border-l @min-[520px]:border-t-0' : ''}`}>
      <div className="flex min-h-5 flex-wrap items-center justify-between gap-2">
        <h4 className="text-[13px] font-medium text-[#555555]">{label}</h4>
        {status && (
          <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-[#B42318]">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#EF4444]" />
            {status}
          </span>
        )}
      </div>

      <div className="my-5 flex items-baseline gap-2">
        <span className="font-mono text-[64px] font-medium leading-none tracking-[-0.07em] text-[#111111] tabular-nums">
          {Math.round(remainingPercent)}
        </span>
        <span className="text-[22px] font-medium text-[#777777]">%</span>
        <span className="ml-1 text-[11px] text-[#888888]">剩余</span>
      </div>

      <div
        role="progressbar"
        aria-label={`${label}剩余`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={remainingPercent}
        aria-valuetext={`剩余 ${Math.round(remainingPercent)}%`}
        className="h-1.5 overflow-hidden rounded-full bg-[#F0F0F0]"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-700 motion-reduce:transition-none ${progressColor}`}
          style={{ width: `${remainingPercent}%` }}
        />
      </div>

      <div className="mt-5 flex items-center gap-1.5 text-[11px] text-[#777777]">
        <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
        <span>{formatUsageResetAt(window.resetsAt)}</span>
      </div>
    </div>
  );
};

const ActiveAccount: React.FC<ActiveAccountProps> = ({
  isEmailMaskingEnabled,
  onNavigateToAccounts,
  usageRevision,
  onRefreshUsage,
  isUsageRefreshing,
}) => {
  const { accounts, activeAccountId, isLoading, refresh } = useAccounts();
  const [usageError, setUsageError] = useState<string | null>(null);
  const activeAccountRef = useRef(activeAccountId);
  activeAccountRef.current = activeAccountId;

  useEffect(() => {
    if (usageRevision > 0) {
      void refresh(false);
    }
  }, [refresh, usageRevision]);

  useEffect(() => {
    setUsageError(null);
  }, [activeAccountId]);

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

  const usageWindows: Array<{
    window: AccountUsageWindow;
    kind: 'primary' | 'secondary';
  }> = [];
  if (activeAccount.usage?.primary) {
    usageWindows.push({ window: activeAccount.usage.primary, kind: 'primary' });
  }
  if (activeAccount.usage?.secondary) {
    usageWindows.push({ window: activeAccount.usage.secondary, kind: 'secondary' });
  }
  const usageRefreshing = activeAccount.canRefreshUsage && isUsageRefreshing(activeAccount.id);

  const handleRefreshUsage = async () => {
    setUsageError(null);
    try {
      await onRefreshUsage(activeAccount.id);
    } catch (error: any) {
      if (activeAccountRef.current === activeAccount.id) setUsageError(error?.message || error?.toString() || '额度刷新失败');
    }
  };

  return (
    <div className="@container mx-auto flex h-full min-h-0 w-full max-w-4xl flex-col pt-4 pb-1">
      <header className="mb-6 shrink-0">
        <h2 className="mb-1 text-[20px] font-semibold tracking-tight text-black">当前账号</h2>
        <p className="text-[13px] text-[#777777]">每 5 分钟同步会话，自动更新账号剩余额度。</p>
      </header>

      <div className="min-h-0 overflow-y-auto pb-1">
        <section aria-label="当前账号概览" className="overflow-hidden rounded-2xl border border-[#E5E5E5] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.025)]">
          <div className="flex items-center gap-4 px-6 py-7 @min-[520px]:gap-5 @min-[520px]:px-7">
            <div aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#171717] text-white">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-[#666666]">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#10B981]" />
                  当前使用中
                </span>
                <PlanBadge planType={activeAccount.chatgptPlanType} />
              </div>
              <h3 className="break-all font-mono text-[21px] font-semibold leading-snug tracking-tight text-black @min-[520px]:text-[26px]">
                {getDisplayedEmail(activeAccount.name, isEmailMaskingEnabled)}
              </h3>
              {activeAccount.notes && (
                <p className="mt-1.5 line-clamp-2 break-all text-[12px] leading-relaxed text-[#777777]" title={activeAccount.notes}>
                  {activeAccount.notes}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-y border-[#EAEAEA] bg-[#FAFAFA] px-6 py-3 @min-[520px]:px-7">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="text-[12px] font-semibold text-[#333333]">剩余额度</h3>
              <span className="text-[10px] text-[#888888]">
                {activeAccount.usage ? formatUsageSyncedAt(activeAccount.usage.syncedAt) : '等待首次同步'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void handleRefreshUsage()}
              disabled={!activeAccount.canRefreshUsage || usageRefreshing}
              title={activeAccount.canRefreshUsage ? '立即刷新额度' : '该账号暂无可用认证，无法刷新额度'}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[#DDDDDD] bg-white px-3 text-[11px] font-medium text-[#555555] transition-colors hover:border-[#AAAAAA] hover:text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:cursor-not-allowed disabled:opacity-45"
            >
              <svg
                aria-hidden="true"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={usageRefreshing ? 'animate-spin motion-reduce:animate-none' : ''}
              >
                <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5" />
                <path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" />
              </svg>
              {usageRefreshing ? '刷新中' : '刷新额度'}
            </button>
          </div>

          {usageError && (
            <div role="alert" className="mx-6 mt-4 flex items-start gap-2 rounded-lg border border-[#FFD0D0] bg-[#FFF5F5] px-3.5 py-2.5 text-[11px] text-[#C62828] @min-[520px]:mx-7">
              <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
              <span className="break-all">{usageError}</span>
            </div>
          )}

          {usageWindows.length > 0 ? (
            <div className={`grid grid-cols-1 ${usageWindows.length > 1 ? '@min-[520px]:grid-cols-2' : ''}`}>
              {usageWindows.map(({ window, kind }, index) => (
                <UsageOverview key={kind} window={window} kind={kind} separated={index > 0} />
              ))}
            </div>
          ) : (
            <div className="flex min-h-[220px] flex-col items-center justify-center px-6 py-8 text-center">
              <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mb-4 text-[#999999]"><path d="M3 3v18h18"/><path d="m7 16 4-5 4 3 4-7"/></svg>
              <p className="text-[13px] font-medium text-[#555555]">
                {activeAccount.canRefreshUsage
                  ? activeAccount.usage ? '接口暂未返回额度信息' : '尚未同步额度'
                  : '暂无可用认证，无法同步额度'}
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-[#888888]">
                {activeAccount.canRefreshUsage
                  ? '每 5 分钟读取会话返回的最新额度，也可以点击上方刷新额度。'
                  : '请前往账号管理，配置 PAT 或完成 OAuth 登录。'}
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#EAEAEA] px-6 py-4 @min-[520px]:px-7">
            <div>
              <p className="text-[12px] font-medium text-[#555555]">账号管理</p>
              <p className="mt-1 text-[11px] text-[#888888]">已保存 {accounts.length} 个账号，可管理或切换当前账号。</p>
            </div>
            <button
              type="button"
              onClick={onNavigateToAccounts}
              className="group inline-flex h-9 shrink-0 items-center gap-3 rounded-lg bg-[#171717] px-4 text-[11px] font-medium text-white transition-colors hover:bg-[#333333] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            >
              管理账号
              <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};

export default ActiveAccount;
