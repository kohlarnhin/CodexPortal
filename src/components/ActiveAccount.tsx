import React, { useEffect, useState } from 'react';
import { useAccounts } from '../hooks/useAccounts';
import { getDisplayedEmail } from '../utils/accountEmail';
import PlanBadge from './PlanBadge';
import { AccountUsage, AccountUsageWindow, AccountWindowSnapshot } from '../types/account';
import { formatTokens } from '../utils/format';
import { formatDateTime } from '../utils/time';
import { calcSnapshotCost, formatCost } from '../utils/modelPricing';
import {
  formatNextRefreshAt,
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

const LinearProgress = ({ 
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
    <div className="flex items-center gap-5">
      <div className="w-32 shrink-0">
        <span className="block text-[14px] font-medium text-[#333333] tracking-wide">
          {formatUsageWindowLabel(window, kind)}
        </span>
        <span className="mt-1 block text-[10px] text-[#999999]">
          {formatUsageResetAt(window.resetsAt)}
        </span>
      </div>
      
      <div className="flex-1 h-2 bg-[#F0F0F0] rounded-full overflow-hidden">
        <div 
          className={`h-full rounded-full transition-all duration-1000 ease-out ${progressColor}`}
          style={{ width: `${remainingPercent}%` }}
        />
      </div>
      
      <div className="w-24 shrink-0 text-right">
        <div className="flex items-baseline justify-end gap-1">
          <span className="mr-1 text-[10px] font-medium text-[#777777]">剩余</span>
          <span className="text-[18px] font-bold text-black font-mono tracking-tight leading-none">
            {Math.round(remainingPercent)}
          </span>
          <span className="text-[12px] text-[#666666] font-medium">%</span>
        </div>
      </div>
    </div>
  );
};

/** 窗口总额估算：消耗金额 ÷ 窗口内消耗的剩余百分点 × 100。
 *  口径为"剩余量"：起点剩余 37% → 当前剩余 29%，差值 8% 即该窗口的消耗。
 *  起点额度缺失或差值过小时不推算。 */
const WindowEstimate: React.FC<{
  snapshot: AccountWindowSnapshot;
  usagePercent: number;
}> = ({ snapshot, usagePercent }) => {
  if (snapshot.startUsedPercent === null || snapshot.startUsedPercent === undefined) return null;
  // 当前剩余量 = 100 − 已用百分比（接口 usedPercent 为已用量）。
  const currentRemaining = 100 - usagePercent;
  const consumed = snapshot.startUsedPercent - currentRemaining;
  if (consumed <= 0.5) return null;
  const windowTotal = (calcSnapshotCost(snapshot) * 100) / consumed;
  return (
    <span className="block text-[10px] text-[#999999]" title={`起点剩余 ${snapshot.startUsedPercent.toFixed(0)}% → 当前剩余 ${currentRemaining.toFixed(0)}%`}>
      窗口总额 ≈ {formatCost(windowTotal)}
    </span>
  );
};

const ActiveAccount: React.FC<ActiveAccountProps> = ({
  isEmailMaskingEnabled,
  onNavigateToAccounts,
  usageRevision,
  onRefreshUsage,
  isUsageRefreshing,
}) => {
  const { accounts, activeAccountId, isLoading, refresh, getAccountWindowSnapshots } = useAccounts();
  const [usageError, setUsageError] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<AccountWindowSnapshot[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);

  useEffect(() => {
    if (usageRevision > 0) {
      void refresh(false);
    }
  }, [refresh, usageRevision]);

  // 加载当前账号最近 3 个窗口额度快照，并每 1 分钟自动静默刷新（进行中窗口实时累计）。
  useEffect(() => {
    if (!activeAccountId) {
      setSnapshots([]);
      return;
    }
    let cancelled = false;
    const loadSnapshots = (showLoading: boolean) => {
      if (showLoading) setSnapshotsLoading(true);
      getAccountWindowSnapshots(activeAccountId, 2)
        .then(data => {
          if (!cancelled) setSnapshots(data);
        })
        .catch(() => {
          if (!cancelled) setSnapshots([]);
        })
        .finally(() => {
          if (!cancelled && showLoading) setSnapshotsLoading(false);
        });
    };
    loadSnapshots(true);
    const timer = window.setInterval(() => loadSnapshots(false), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeAccountId, getAccountWindowSnapshots]);

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
      setUsageError(error?.message || error?.toString() || '额度刷新失败');
    }
  };

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
                <PlanBadge planType={activeAccount.chatgptPlanType} />
              </div>
              <p className="text-[14px] text-[#666666]">{activeAccount.notes || '无备注信息'}</p>
            </div>
          </div>

          <div className="pt-2">
            <div className="mb-6 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <label className="block text-[13px] font-semibold uppercase tracking-wider text-black">
                  最新额度
                </label>
                <span className="flex items-center gap-1 rounded-full border border-[#EAEAEA] bg-[#F7F7F7] px-2.5 py-0.5 text-[10px] font-medium text-[#777777]">
                  <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
                  {formatNextRefreshAt(activeAccount.nextRefreshAt, activeAccount.usage)}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {activeAccount.usage && (
                  <span className="text-[10px] text-[#999999]">
                    {formatUsageSyncedAt(activeAccount.usage.syncedAt)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void handleRefreshUsage()}
                  disabled={!activeAccount.canRefreshUsage || usageRefreshing}
                  title={activeAccount.canRefreshUsage ? '立即刷新额度' : '仅 Personal Access Token 账号支持额度刷新'}
                  className="flex h-8 items-center gap-1.5 rounded-md border border-[#E0E0E0] bg-white px-3 text-[11px] font-medium text-[#555555] shadow-sm transition-all hover:border-[#C8C8C8] hover:text-black disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={usageRefreshing ? 'animate-spin' : ''}
                  >
                    <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5" />
                    <path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" />
                  </svg>
                  {usageRefreshing ? '刷新中' : '刷新'}
                </button>
              </div>
            </div>

            {usageError && (
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-[#FFD0D0] bg-[#FFF5F5] px-3.5 py-2.5 text-[11px] text-[#C62828]">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
                <span className="break-all">{usageError}</span>
              </div>
            )}

            {usageWindows.length > 0 ? (
              <div className="flex flex-col gap-6 rounded-xl border border-[#EAEAEA] bg-white p-6 shadow-sm">
                {usageWindows.map(({ window, kind }) => (
                  <LinearProgress key={kind} window={window} kind={kind} />
                ))}
              </div>
            ) : (
              <div className="flex min-h-[126px] items-center justify-center rounded-xl border border-dashed border-[#D8D8D8] bg-[#FAFAFA] px-6 text-center">
                <div>
                  <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-lg border border-[#EAEAEA] bg-white text-[#777777] shadow-sm">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="m7 16 4-5 4 3 4-7"/></svg>
                  </div>
                  <p className="text-[12px] font-semibold text-[#555555]">
                    {activeAccount.canRefreshUsage
                      ? activeAccount.usage
                        ? '接口暂未返回额度窗口'
                        : '尚未同步额度'
                      : '当前认证格式暂不支持额度同步'}
                  </p>
                  <p className="mt-1 text-[11px] text-[#999999]">
                    {activeAccount.canRefreshUsage
                      ? '系统会自动更新，也可以点击右上角立即刷新'
                      : '请使用 Personal Access Token 账号获取额度'}
                  </p>
                </div>
              </div>
            )}

            {/* 最近窗口额度（进行中的当前窗口实时计算 + 历史切换快照，最多 3 个） */}
            <div className="mt-6 pt-6 border-t border-[#EAEAEA]">
              <div className="mb-3 flex items-center justify-between gap-4">
                <label className="block text-[13px] font-semibold uppercase tracking-wider text-black">
                  最近窗口额度
                </label>
                <span className="text-[10px] text-[#999999]">按使用周期估算 · 金额按 API 标准价估算</span>
              </div>
              {snapshotsLoading ? (
                <div className="h-10 rounded-lg bg-[#F7F7F7] animate-pulse" />
              ) : snapshots.length === 0 ? (
                <div className="flex h-10 items-center justify-center rounded-lg border border-dashed border-[#D8D8D8] bg-[#FAFAFA] text-[12px] text-[#999999]">
                  -
                </div>
              ) : (
                <div className="flex flex-col overflow-hidden rounded-xl border border-[#EAEAEA]">
                  {snapshots.map((snapshot, index) => (
                    <div
                      key={index}
                      className={`flex items-center gap-4 px-4 py-2.5 ${index > 0 ? 'border-t border-[#F0F0F0]' : ''}`}
                    >
                      <div className="w-32 shrink-0">
                        {snapshot.isActive ? (
                          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-black">
                            <span className="relative flex h-1.5 w-1.5">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            </span>
                            使用中
                          </div>
                        ) : (
                          <span className="block font-mono text-[12px] text-[#666666]">
                            {snapshot.windowStartAt ? formatDateTime(snapshot.windowStartAt) : '—'}
                          </span>
                        )}
                        <span className="block truncate text-[10px] text-[#AAAAAA]">
                          {snapshot.isActive
                            ? `自 ${formatDateTime(snapshot.switchedAt)}`
                            : `→ ${formatDateTime(snapshot.switchedAt)}`}
                        </span>
                      </div>
                      <span className="shrink-0 rounded-full border border-[#EAEAEA] bg-[#F5F5F5] px-2 py-0.5 text-[10px] font-medium text-[#666666]">
                        {snapshot.planType || '未知'}
                      </span>
                      <span className="flex-1 truncate text-[12px] text-[#888888]">
                        消耗 {formatTokens(snapshot.totalTokens)} tokens
                        {snapshot.isActive && activeAccount.usage?.primary && (
                          <span className="text-[#999999]">
                            {' '}· 剩余 {Math.round(getRemainingPercent(activeAccount.usage.primary))}%
                          </span>
                        )}
                      </span>
                      <div className="shrink-0 text-right">
                        <span className="block text-[12px] font-bold text-black">
                          {formatCost(calcSnapshotCost(snapshot))}
                        </span>
                        {snapshot.isActive && activeAccount.usage?.primary && (
                          <WindowEstimate snapshot={snapshot} usagePercent={activeAccount.usage.primary.usedPercent} />
                        )}
                        {!snapshot.isActive && snapshot.windowTotalCost !== null && snapshot.windowTotalCost !== undefined && (
                          <span className="block text-[10px] text-[#999999]">
                            窗口总额 ≈ {formatCost(snapshot.windowTotalCost)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
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
