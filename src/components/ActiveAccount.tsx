import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAccounts } from '../hooks/useAccounts';
import { getDisplayedEmail } from '../utils/accountEmail';
import PlanBadge from './PlanBadge';
import CodexSessionsPanel from './CodexSessionsPanel';
import type { CodexLiveUsage, CodexSessionMonitor } from '../types/codexEvents';
import Button from './ui/button';
import { ActionTooltip } from './ui/tooltip';
import PageHeader from './ui/page-header';
import { AccountUsageWindow } from '../types/account';
import {
  formatUsageResetAt,
  formatUsageSyncedAt,
  formatUsageWindowLabel,
  getRemainingPercent,
  getUsageTone,
  resolveCurrentUsage,
  USAGE_TONE_FILL,
  type UsageTone,
} from '../utils/accountUsage';
import { cn } from '../lib/utils';
import { ArrowLeftRight, ArrowRight, Calendar, ChartLine, Check, CircleAlert, Clock, Copy, RefreshCw, User } from 'lucide-react';

interface ActiveAccountProps {
  isEmailMaskingEnabled: boolean;
  onNavigateToAccounts: () => void;
  usageRevision: number;
  liveUsage: CodexLiveUsage;
  onRefreshUsage: () => Promise<void>;
  sessionMonitor: CodexSessionMonitor;
  onRefreshSessions: () => void;
  onViewLogs: () => void;
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

const USAGE_TONE_LABEL: Record<UsageTone, string> = {
  unknown: '额度未知',
  danger: '余量紧张',
  warning: '余量正常',
  success: '余量充裕',
};

const USAGE_TONE_BADGE: Record<UsageTone, string> = {
  unknown: 'bg-muted/40 text-muted-foreground border-border',
  danger: 'bg-destructive/10 text-destructive border-destructive/20',
  warning: 'bg-warning/10 text-warning border-warning/20',
  success: 'bg-success/10 text-success border-success/20',
};

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

  const tone = getUsageTone(remainingPercent);
  const isExhausted = remainingPercent !== null && remainingPercent <= 0;
  const statusLabel = isExhausted ? '额度耗尽' : USAGE_TONE_LABEL[tone];

  const usedPercent =
    remainingPercent !== null ? Math.max(0, 100 - Math.round(remainingPercent)) : null;

  return (
    <div className="flex flex-col justify-between rounded-xl border bg-card p-5 shadow-xs">
      <div>
        {/* 卡片头部 */}
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md border bg-muted/50 text-muted-foreground">
              {kind === 'primary' ? (
                <Clock size={15} />
              ) : (
                <Calendar size={15} />
              )}
            </div>
            <h4 className="text-body font-medium text-foreground">
              {label}
            </h4>
          </div>

          <span
            className={cn(
              'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-caption font-medium border',
              USAGE_TONE_BADGE[tone]
            )}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', USAGE_TONE_FILL[tone])} />
            {statusLabel}
          </span>
        </div>

        {/* 核心数值展示 */}
        <div className="mt-5 mb-3 flex items-baseline justify-between">
          <div className="flex items-baseline gap-2">
            <span className="text-[36px] font-semibold leading-none tracking-tight text-foreground tabular-nums">
              {remainingPercent === null ? '—' : Math.round(remainingPercent)}
            </span>
            {remainingPercent !== null && (
              <span className="text-[18px] font-medium text-muted-foreground">%</span>
            )}
            <span className="ml-1 text-body text-muted-foreground">剩余</span>
          </div>

          {usedPercent !== null && (
            <span className="text-label text-muted-foreground tabular-nums">
              已消耗 {usedPercent}%
            </span>
          )}
        </div>

        {/* 额度进度条 */}
        <div className="mb-5">
          <div
            role="progressbar"
            aria-label={`${label}剩余`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={remainingPercent ?? undefined}
            aria-valuetext={
              remainingPercent === null ? '额度未知' : `剩余 ${Math.round(remainingPercent)}%`
            }
            className="h-2 w-full overflow-hidden rounded-full bg-primary/10"
          >
            <div
              className={cn('h-full rounded-full transition-all duration-500', USAGE_TONE_FILL[tone])}
              style={{ width: `${Math.max(0, Math.min(100, remainingPercent ?? 0))}%` }}
            />
          </div>
        </div>
      </div>

      {/* 卡片底栏信息 */}
      <div className="flex items-center justify-between text-label text-muted-foreground pt-3.5 border-t">
        <span className="flex items-center gap-1.5">
          <Clock size={13} className="text-muted-foreground shrink-0" />
          <span>
            {formatUsageResetAt(window.resetsAt)}
            {relativeTime && (
              <span className="ml-1 text-muted-foreground font-normal">({relativeTime})</span>
            )}
          </span>
        </span>
        {window.windowMinutes && (
          <span className="text-muted-foreground text-caption font-mono shrink-0">
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
  liveUsage,
  onRefreshUsage,
  sessionMonitor,
  onRefreshSessions,
  onViewLogs,
}) => {
  const { accounts, activeAccountId, isLoading, refresh } = useAccounts();
  const [usageError, setUsageError] = useState<string | null>(null);
  const [syncingUsage, setSyncingUsage] = useState(false);
  const [copied, setCopied] = useState(false);
  const activeAccountRef = useRef(activeAccountId);
  activeAccountRef.current = activeAccountId;
  const cachedUsageSyncedAt = accounts.find(account => account.id === activeAccountId)?.usage?.syncedAt;

  useEffect(() => {
    if (usageRevision > 0) {
      void refresh(false);
    }
  }, [refresh, usageRevision]);

  useEffect(() => {
    setUsageError(null);
  }, [activeAccountId, cachedUsageSyncedAt, liveUsage.usage?.syncedAt]);

  if (isLoading) {
    return (
      <div className="page-layout pt-4">
        <div className="page-header block">
          <div className="h-6 w-28 bg-muted rounded-md animate-pulse mb-2"></div>
          <div className="h-3.5 w-56 bg-muted rounded-md animate-pulse"></div>
        </div>
        <div className="h-24 bg-muted/50 rounded-xl animate-pulse mb-4"></div>
        <div className="grid grid-cols-1 @min-[600px]/page:grid-cols-2 gap-4">
          <div className="h-40 bg-muted/50 rounded-xl animate-pulse"></div>
          <div className="h-40 bg-muted/50 rounded-xl animate-pulse"></div>
        </div>
      </div>
    );
  }

  const activeAccount = accounts.find((a) => a.id === activeAccountId);

  if (!activeAccount) {
    return (
      <div className="page-layout pt-4">
        <div className="flex min-h-[420px] flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <CircleAlert />
          </div>
          <h2 className="mb-1.5 text-title font-semibold text-foreground">未设置活跃账号</h2>
          <p className="mb-6 max-w-sm text-body text-muted-foreground leading-relaxed">
            当前没有正在使用的 Codex 账号配置。请前往“账号管理”页面选择或添加一个账号。
          </p>
          <Button onClick={onNavigateToAccounts} size="sm" className="gap-2">
            <span>前往账号管理</span>
            <ArrowRight size={14} />
          </Button>
        </div>
      </div>
    );
  }

  const usageWindows: Array<{
    window: AccountUsageWindow;
    kind: 'primary' | 'secondary';
  }> = [];
  const { usage: currentUsage, isLive: displayingLive } = resolveCurrentUsage(activeAccount, liveUsage);
  if (currentUsage?.primary) {
    usageWindows.push({ window: currentUsage.primary, kind: 'primary' });
  }
  if (currentUsage?.secondary) {
    usageWindows.push({ window: currentUsage.secondary, kind: 'secondary' });
  }
  const usageRefreshing = syncingUsage || liveUsage.accountId === activeAccount.id && liveUsage.isRefreshing;
  const displayedUsageError = usageError ?? (displayingLive ? liveUsage.error : null);
  const firstChar = (activeAccount.name || '').trim().charAt(0).toUpperCase();
  const avatarLetter = /^[A-Z0-9]$/i.test(firstChar) ? firstChar : null;

  const handleRefreshUsage = async () => {
    setUsageError(null);
    setSyncingUsage(true);
    try {
      if (sessionMonitor.connectionStatus === 'connected') await onRefreshUsage();
      else await invoke('sync_sessions');
      await refresh(false);
    } catch (error: any) {
      if (activeAccountRef.current === activeAccount.id) {
        setUsageError(error?.message || error?.toString() || '额度刷新失败');
      }
    } finally {
      setSyncingUsage(false);
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
      <PageHeader
        title="当前账号"
        badge={currentUsage && (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-caption font-medium bg-background text-muted-foreground border">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            {displayingLive ? liveUsage.source === 'push' ? '实时推送' : liveUsage.source === 'manualRead' ? '手动读取' : '初始额度' : '已同步额度'} · {formatUsageSyncedAt(currentUsage.syncedAt)}
          </span>
        )}
        description="会话同步更新当前账号额度，启用实时监听后也会接收额度推送。"
      />

      <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-y-auto overflow-x-hidden">
        {/* 账号身份卡片 */}
        <section
          aria-label="账号信息"
          className="rounded-xl border bg-card p-5 shadow-xs shrink-0"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              {/* 头像：账号首字母 + 当前生效状态点 */}
              <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border bg-muted text-foreground select-none">
                {avatarLetter ? (
                  <span className="text-title font-semibold">{avatarLetter}</span>
                ) : (
                  <User size={18} />
                )}
                <span
                  className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-success ring-2 ring-background"
                  title="当前生效账号"
                />
              </div>

              {/* 账号信息区：邮箱为主标题，属性与备注更富层次 */}
              <div className="min-w-0 flex-1">
                {/* 第一行：邮箱主体 + 复制按钮 + 计划徽标 + 当前生效徽标 */}
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <h3 className="break-all text-title font-semibold tracking-tight text-foreground leading-6 select-text">
                    {getDisplayedEmail(activeAccount.name, isEmailMaskingEnabled)}
                  </h3>
                  <ActionTooltip label={copied ? '已复制' : '复制账号'}>
                    <button
                      type="button"
                      onClick={handleCopyEmail}
                      className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
                      aria-label="复制账号"
                    >
                      {copied ? (
                        <Check size={14} strokeWidth={2.5} className="text-success" />
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                  </ActionTooltip>

                  <PlanBadge planType={activeAccount.chatgptPlanType} />

                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-caption font-medium bg-success/10 text-success border border-success/25">
                    <span className="h-1.5 w-1.5 rounded-full bg-success" />
                    当前生效
                  </span>
                </div>

                {/* 第二行：备注与辅助属性标签 */}
                <div className="flex flex-wrap items-center gap-2 text-label text-muted-foreground">
                  {activeAccount.notes ? (
                    <span
                      className="text-foreground/80 line-clamp-1"
                      title={activeAccount.notes}
                    >
                      {activeAccount.notes}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Codex 活跃会话凭据</span>
                  )}

                  {(activeAccount.autoActivateWindow || activeAccount.resetCredits) && (
                    <span className="text-muted-foreground/50">·</span>
                  )}

                  {activeAccount.autoActivateWindow && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-caption font-medium bg-muted text-muted-foreground">
                      自动唤醒已开
                    </span>
                  )}
                  {activeAccount.resetCredits && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-caption font-medium bg-warning/10 text-warning">
                      重置卡 ×{activeAccount.resetCredits.availableCount}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* 右侧：集成式操作工具栏（纯图标 + 悬浮文字） */}
            <div className="flex items-center self-start sm:self-center shrink-0">
              <div className="flex items-center gap-2">
                <ActionTooltip label={usageRefreshing ? '正在刷新额度...' : sessionMonitor.connectionStatus === 'connected' ? '立即刷新额度' : '同步会话额度'}>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => void handleRefreshUsage()}
                    disabled={usageRefreshing}
                    aria-label="刷新额度"
                    className="text-foreground"
                  >
                    <RefreshCw size={14} className={usageRefreshing ? 'animate-spin' : ''} />
                  </Button>
                </ActionTooltip>

                <ActionTooltip label="前往账号管理与切换">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={onNavigateToAccounts}
                    aria-label="切换账号"
                    className="text-foreground"
                  >
                    <ArrowLeftRight size={14} />
                  </Button>
                </ActionTooltip>
              </div>
            </div>
          </div>
        </section>

        {/* 错误提示 */}
        {displayedUsageError && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-label text-destructive"
          >
            <CircleAlert size={15} className="mt-0.5 shrink-0" />
            <span className="flex-1 break-all">{displayedUsageError}</span>
          </div>
        )}

        {/* 额度数据看板 */}
        {usageWindows.length > 0 ? (
          <div
            className={`grid grid-cols-1 ${
              usageWindows.length > 1 ? '@min-[600px]/page:grid-cols-2' : ''
            } gap-4`}
          >
            {usageWindows.map(({ window, kind }) => (
              <UsageCard key={kind} window={window} kind={kind} />
            ))}
          </div>
        ) : (
          <div className="flex min-h-[200px] flex-col items-center justify-center rounded-xl border border-dashed px-6 py-8 text-center">
            <ChartLine strokeWidth={1.5} className="mb-3 text-muted-foreground" />
            <p className="text-subtitle font-medium text-foreground">
              {usageRefreshing ? '正在更新额度…' : currentUsage ? '暂未同步到额度明细' : '等待当前账号额度'}
            </p>
            <p className="mt-1.5 max-w-sm text-label leading-relaxed text-muted-foreground">
              使用本地会话后，同步会话即可更新这里的额度；实时监听可用时也会接收额度推送。
            </p>
          </div>
        )}

        {sessionMonitor.connectionStatus !== 'unavailable' && (
          <CodexSessionsPanel monitor={sessionMonitor} onRefresh={onRefreshSessions} onViewLogs={onViewLogs} />
        )}
      </div>
    </div>
  );
};

export default ActiveAccount;

