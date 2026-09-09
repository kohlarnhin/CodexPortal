import React, { useEffect, useRef, useState } from 'react';
import { useAccounts } from '../hooks/useAccounts';
import { getDisplayedEmail } from '../utils/accountEmail';
import PlanBadge from './PlanBadge';
import Button from './ui/button';
import { ActionTooltip } from './ui/tooltip';
import { AccountUsage, AccountUsageWindow } from '../types/account';
import {
  formatUsageResetAt,
  formatUsageSyncedAt,
  formatUsageWindowLabel,
  getRemainingPercent,
} from '../utils/accountUsage';
import { cn } from '../lib/utils';

interface ActiveAccountProps {
  isEmailMaskingEnabled: boolean;
  onNavigateToAccounts: () => void;
  usageRevision: number;
  onRefreshUsage: (accountId: string) => Promise<AccountUsage>;
  isUsageRefreshing: (accountId: string) => boolean;
}

function getRelativeResetTime(resetsAt: number | null): string | null {
  if (!resetsAt) return null;
  const now = Math.floor(Date.now() / 1000);
  const diffSec = resetsAt - now;
  if (diffSec <= 0) return '即将重置';
  const hours = Math.floor(diffSec / 3600);
  const mins = Math.floor((diffSec % 3600) / 60);
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `约 ${days} 天后`;
  }
  if (hours > 0) {
    return mins > 0 ? `约 ${hours} 小时 ${mins} 分钟后` : `约 ${hours} 小时后`;
  }
  return `约 ${Math.max(1, mins)} 分钟后`;
}

const UsageCard = ({
  window,
  kind,
}: {
  window: AccountUsageWindow;
  kind: 'primary' | 'secondary';
}) => {
  const remainingPercent = getRemainingPercent(window);
  const label = formatUsageWindowLabel(window, kind);
  const relativeTime = getRelativeResetTime(window.resetsAt);

  const isExhausted = remainingPercent !== null && remainingPercent <= 0;
  const isLow = remainingPercent !== null && remainingPercent > 0 && remainingPercent <= 20;
  const isMedium = remainingPercent !== null && remainingPercent > 20 && remainingPercent <= 50;

  const statusLabel = isExhausted
    ? '额度耗尽'
    : isLow
      ? '余量紧张'
      : isMedium
        ? '余量正常'
        : '余量充裕';

  const statusBadgeClass = isExhausted || isLow
    ? 'bg-red-50 text-red-700 border-red-200/60'
    : isMedium
      ? 'bg-amber-50 text-amber-700 border-amber-200/60'
      : 'bg-emerald-50 text-emerald-700 border-emerald-200/60';

  const dotColorClass = isExhausted || isLow
    ? 'bg-[#EF4444]'
    : isMedium
      ? 'bg-[#F59E0B]'
      : 'bg-[#10B981]';

  const progressColor =
    remainingPercent === null
      ? 'bg-[#E0E0E0]'
      : isExhausted || isLow
        ? 'bg-[#EF4444]'
        : isMedium
          ? 'bg-[#F59E0B]'
          : 'bg-[#10B981]';

  const usedPercent =
    remainingPercent !== null ? Math.max(0, 100 - Math.round(remainingPercent)) : null;

  return (
    <div className="flex flex-col justify-between rounded-xl border border-neutral-200/80 bg-white p-5 sm:p-6 shadow-2xs transition-all hover:border-neutral-300">
      <div>
        {/* 卡片头部 */}
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100/80 text-neutral-700 border border-neutral-200/60">
              {kind === 'primary' ? (
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              ) : (
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
                  <line x1="16" x2="16" y1="2" y2="6" />
                  <line x1="8" x2="8" y1="2" y2="6" />
                  <line x1="3" x2="21" y1="10" y2="10" />
                </svg>
              )}
            </div>
            <h4 className="text-[13px] font-semibold text-neutral-800 tracking-tight">
              {label}
            </h4>
          </div>

          <span
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-medium border',
              statusBadgeClass
            )}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', dotColorClass)} />
            {statusLabel}
          </span>
        </div>

        {/* 核心数值展示：还原原版巨幅等宽数字与纵向呼吸感 */}
        <div className="my-5 flex items-baseline justify-between">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[52px] sm:text-[62px] font-medium leading-none tracking-[-0.06em] text-neutral-900 tabular-nums">
              {remainingPercent === null ? '—' : Math.round(remainingPercent)}
            </span>
            {remainingPercent !== null && (
              <span className="text-[22px] font-medium text-neutral-400 font-mono">%</span>
            )}
            <span className="ml-1 text-[13px] font-medium text-neutral-400">剩余</span>
          </div>

          {usedPercent !== null && (
            <span className="text-[12.5px] font-mono font-medium text-neutral-400">
              已消耗 {usedPercent}%
            </span>
          )}
        </div>

        {/* 额度进度条：与账号管理页面完全一致的极简轨道 */}
        <div className="my-4.5">
          <div
            role="progressbar"
            aria-label={`${label}剩余`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={remainingPercent ?? undefined}
            aria-valuetext={
              remainingPercent === null ? '额度未知' : `剩余 ${Math.round(remainingPercent)}%`
            }
            className="h-2 w-full overflow-hidden rounded-full bg-[#EAEAEA]"
          >
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                progressColor
              )}
              style={{ width: `${Math.max(0, Math.min(100, remainingPercent ?? 0))}%` }}
            />
          </div>
        </div>
      </div>

      {/* 卡片底栏信息 */}
      <div className="flex items-center justify-between text-[11.5px] text-neutral-500 pt-3.5 border-t border-neutral-100">
        <span className="flex items-center gap-1.5">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-neutral-400 shrink-0"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span>
            {formatUsageResetAt(window.resetsAt)}
            {relativeTime && (
              <span className="ml-1 text-neutral-400 font-normal">({relativeTime})</span>
            )}
          </span>
        </span>
        {window.windowMinutes && (
          <span className="text-neutral-400 text-[10.5px] font-mono shrink-0">
            {window.windowMinutes >= 1440
              ? `${Math.round(window.windowMinutes / 1440)} 天周期`
              : `${Math.round(window.windowMinutes / 60)} 小时周期`}
          </span>
        )}
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
  const [copied, setCopied] = useState(false);
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
    return (
      <div className="page-layout pt-4">
        <div className="page-header mb-6">
          <div className="h-6 w-28 bg-[#EAEAEA] rounded animate-pulse mb-2"></div>
          <div className="h-3.5 w-56 bg-[#F0F0F0] rounded animate-pulse"></div>
        </div>
        <div className="h-24 bg-white border border-[#EAEAEA] rounded-xl animate-pulse mb-4"></div>
        <div className="grid grid-cols-1 @min-[600px]/page:grid-cols-2 gap-4">
          <div className="h-40 bg-white border border-[#EAEAEA] rounded-xl animate-pulse"></div>
          <div className="h-40 bg-white border border-[#EAEAEA] rounded-xl animate-pulse"></div>
        </div>
      </div>
    );
  }

  const activeAccount = accounts.find((a) => a.id === activeAccountId);

  if (!activeAccount) {
    return (
      <div className="page-layout pt-4">
        <div className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-200 bg-white/60 p-8 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-400">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h2 className="mb-1.5 text-[16px] font-semibold text-neutral-900">未设置活跃账号</h2>
          <p className="mb-6 max-w-sm text-[13px] text-neutral-500 leading-relaxed">
            当前没有正在使用的 Codex 账号配置。请前往“账号管理”页面选择或添加一个账号。
          </p>
          <Button onClick={onNavigateToAccounts} size="sm" className="gap-2">
            <span>前往账号管理</span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </Button>
        </div>
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
  const firstChar = (activeAccount.name || '').trim().charAt(0).toUpperCase();
  const avatarLetter = /^[A-Z0-9]$/i.test(firstChar) ? firstChar : null;

  const handleRefreshUsage = async () => {
    setUsageError(null);
    try {
      await onRefreshUsage(activeAccount.id);
    } catch (error: any) {
      if (activeAccountRef.current === activeAccount.id) {
        setUsageError(error?.message || error?.toString() || '额度刷新失败');
      }
    }
  };

  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText(activeAccount.name);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="page-layout pt-4 pb-2">
      {/* 标题栏 */}
      <div className="page-header mb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-[20px] font-semibold tracking-tight text-neutral-900">当前账号</h2>
            {activeAccount.usage && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-neutral-100 text-neutral-600 border border-neutral-200/60">
                <span className="h-1.5 w-1.5 rounded-full bg-[#10B981]" />
                {formatUsageSyncedAt(activeAccount.usage.syncedAt)}
              </span>
            )}
          </div>
          <p className="text-[13px] text-neutral-500 mt-1">
            Codex 活跃会话凭据 · 每 5 分钟自动同步剩余额度窗口。
          </p>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col space-y-4 sm:space-y-5 overflow-y-auto overflow-x-hidden">
        {/* 账号身份卡片 */}
        <section
          aria-label="账号信息"
          className="rounded-xl border border-neutral-200/80 bg-white p-5 sm:p-6 shadow-2xs transition-all hover:border-neutral-300 shrink-0"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              {/* 头像：渐变质感 + 动态账号首字母 + 底部脉动在线状态灯 */}
              <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-neutral-900 via-neutral-800 to-neutral-700 text-white shadow-xs ring-1 ring-black/5 select-none">
                {avatarLetter ? (
                  <span className="font-mono text-[19px] font-bold tracking-tight text-neutral-100">
                    {avatarLetter}
                  </span>
                ) : (
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                )}
                {/* 活跃指示呼吸灯徽标 */}
                <span
                  className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white ring-2 ring-white"
                  title="当前生效账号"
                >
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#10B981]" />
                  </span>
                </span>
              </div>

              {/* 账号信息区：邮箱为主标题，属性与备注更富层次 */}
              <div className="min-w-0 flex-1">
                {/* 第一行：邮箱主体 + 复制按钮 + 计划徽标 + 当前生效徽标 */}
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <h3 className="break-all font-mono text-[17px] sm:text-[19px] font-bold tracking-tight text-neutral-900 leading-none select-text">
                    {getDisplayedEmail(activeAccount.name, isEmailMaskingEnabled)}
                  </h3>
                  <ActionTooltip label={copied ? '已复制' : '复制账号'}>
                    <button
                      type="button"
                      onClick={handleCopyEmail}
                      className="p-1 rounded-md text-neutral-400 hover:text-neutral-800 hover:bg-neutral-100 transition-colors cursor-pointer"
                      aria-label="复制账号"
                    >
                      {copied ? (
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          className="text-[#10B981]"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                        </svg>
                      )}
                    </button>
                  </ActionTooltip>

                  <PlanBadge planType={activeAccount.chatgptPlanType} />

                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#10B981]" />
                    当前生效
                  </span>
                </div>

                {/* 第二行：备注与辅助属性标签 */}
                <div className="flex flex-wrap items-center gap-2 text-[12px] text-neutral-500">
                  {activeAccount.notes ? (
                    <span
                      className="text-neutral-600 font-medium line-clamp-1"
                      title={activeAccount.notes}
                    >
                      {activeAccount.notes}
                    </span>
                  ) : (
                    <span className="text-neutral-400">Codex 活跃会话凭据</span>
                  )}

                  {(activeAccount.autoActivateWindow || activeAccount.resetCredits) && (
                    <span className="text-neutral-300">·</span>
                  )}

                  {activeAccount.autoActivateWindow && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-neutral-100 text-neutral-600 border border-neutral-200/60">
                      自动唤醒已开
                    </span>
                  )}
                  {activeAccount.resetCredits && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200/60">
                      重置卡 ×{activeAccount.resetCredits.availableCount}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* 右侧：集成式操作工具栏（纯图标 + 悬浮文字） */}
            <div className="flex items-center self-start sm:self-center shrink-0">
              <div className="flex items-center rounded-lg border border-neutral-200/80 bg-neutral-50/70 p-0.5 shadow-2xs">
                <ActionTooltip label={usageRefreshing ? '正在刷新额度...' : '立即刷新额度'}>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void handleRefreshUsage()}
                    disabled={!activeAccount.canRefreshUsage || usageRefreshing}
                    aria-label="刷新额度"
                    className="h-8 w-8 rounded-md text-neutral-600 hover:text-black hover:bg-white hover:shadow-2xs transition-all cursor-pointer"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={usageRefreshing ? 'animate-spin' : ''}
                    >
                      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                      <path d="M3 3v5h5" />
                      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                      <path d="M16 21h5v-5" />
                    </svg>
                  </Button>
                </ActionTooltip>

                <div className="h-4 w-px bg-neutral-200/90 mx-0.5" />

                <ActionTooltip label="前往账号管理与切换">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onNavigateToAccounts}
                    aria-label="切换账号"
                    className="h-8 w-8 rounded-md text-neutral-600 hover:text-black hover:bg-white hover:shadow-2xs transition-all cursor-pointer"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m16 3 4 4-4 4" />
                      <path d="M20 7H4" />
                      <path d="m8 21-4-4 4-4" />
                      <path d="M4 17h16" />
                    </svg>
                  </Button>
                </ActionTooltip>
              </div>
            </div>
          </div>
        </section>

        {/* 错误提示 */}
        {usageError && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50/80 px-4 py-3 text-[12px] text-red-700 shadow-2xs"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mt-0.5 shrink-0 text-red-600"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span className="flex-1 break-all">{usageError}</span>
          </div>
        )}

        {/* 额度数据看板 */}
        {usageWindows.length > 0 ? (
          <div
            className={`grid grid-cols-1 ${
              usageWindows.length > 1 ? '@min-[600px]/page:grid-cols-2' : ''
            } gap-6`}
          >
            {usageWindows.map(({ window, kind }) => (
              <UsageCard key={kind} window={window} kind={kind} />
            ))}
          </div>
        ) : (
          <div className="flex min-h-[200px] flex-col items-center justify-center rounded-xl border border-dashed border-neutral-200 bg-white/50 px-6 py-8 text-center">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mb-3 text-neutral-400"
            >
              <path d="M3 3v18h18" />
              <path d="m7 16 4-5 4 3 4-7" />
            </svg>
            <p className="text-[13.5px] font-medium text-neutral-700">
              {activeAccount.canRefreshUsage
                ? activeAccount.usage
                  ? '接口暂未返回额度明细'
                  : '尚未同步额度数据'
                : '暂无可用认证，无法同步额度'}
            </p>
            <p className="mt-1.5 max-w-sm text-[12px] leading-relaxed text-neutral-400">
              {activeAccount.canRefreshUsage
                ? '系统每 5 分钟自动读取会话返回的最新额度，也可点击账号卡片上的刷新按钮。'
                : '请前往账号管理页面，配置 PAT 或完成 OAuth 登录。'}
            </p>
          </div>
        )}

        {/* 底部优化状态条 */}
        <div className="rounded-xl border border-neutral-200/70 bg-white/80 px-5 py-3.5 shrink-0 flex items-center justify-between text-[12px] text-neutral-500 shadow-2xs">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#10B981]" />
            </span>
            <span className="text-neutral-700 font-medium">后台会话监测中</span>
            <span className="text-neutral-300">·</span>
            <span className="text-neutral-500">每 5 分钟自动同步会话额度，额度重置后将自动回满</span>
          </div>
          <span className="text-[11.5px] font-mono text-neutral-400">
            共配置 {accounts.length} 个账号
          </span>
        </div>
      </div>
    </div>
  );
};

export default ActiveAccount;

