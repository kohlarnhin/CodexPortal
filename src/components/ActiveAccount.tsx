import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAccounts } from '../hooks/useAccounts';
import { getDisplayedEmail } from '../utils/accountEmail';
import { getAccountApiKey, isApiKeyAccount, maskApiKey } from '../utils/accountAuth';
import PlanBadge from './PlanBadge';
import SchedulePreview from './SchedulePreview';
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
import { ArrowRight, Calendar, ChartLine, Check, CircleAlert, Clock, Copy, RefreshCw, User, Users } from 'lucide-react';

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

const USAGE_TONE_DOT: Record<UsageTone, string> = {
  unknown: 'idle',
  danger: 'error',
  warning: 'warning',
  success: 'success',
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
    <section className="bento-card flex flex-col justify-between overflow-hidden">
      <div className="px-[18px] pt-3.5 pb-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-label text-[var(--label)]">
            {kind === 'primary' ? (
              <Clock size={13} aria-hidden="true" />
            ) : (
              <Calendar size={13} aria-hidden="true" />
            )}
            <h4 className="font-medium">{label}</h4>
          </div>

          <span className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
            <span className="bento-status-dot" data-tone={USAGE_TONE_DOT[tone]} aria-hidden="true" />
            {statusLabel}
          </span>
        </div>

        <div className="mt-4 mb-3 flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-1">
            <span className="text-[34px] font-semibold leading-none tracking-[-0.025em] text-foreground tabular-nums">
              {remainingPercent === null ? '—' : Math.round(remainingPercent)}
            </span>
            {remainingPercent !== null && (
              <span className="text-[16px] font-medium text-muted-foreground">%</span>
            )}
            <span className="ml-1.5 text-label text-muted-foreground">剩余</span>
          </div>

          {usedPercent !== null && (
            <span className="text-caption text-[var(--label)] tabular-nums">
              已消耗 {usedPercent}%
            </span>
          )}
        </div>

        <div
          role="progressbar"
          aria-label={`${label}剩余`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={remainingPercent ?? undefined}
          aria-valuetext={
            remainingPercent === null ? '额度未知' : `剩余 ${Math.round(remainingPercent)}%`
          }
          className="h-[5px] w-full overflow-hidden rounded-full bg-[var(--button-fill)]"
        >
          <div
            className={cn('h-full rounded-full transition-all duration-500', USAGE_TONE_FILL[tone])}
            style={{ width: `${Math.max(0, Math.min(100, remainingPercent ?? 0))}%` }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-[var(--hairline-divider)] px-[18px] py-2.5 text-caption text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          <Clock size={12} className="shrink-0 text-[var(--label)]" aria-hidden="true" />
          <span className="truncate">
            {formatUsageResetAt(window.resetsAt)}
            {relativeTime && (
              <span className="ml-1 text-[var(--label)]">· {relativeTime}</span>
            )}
          </span>
        </span>
        {window.windowMinutes && (
          <span className="shrink-0 font-mono text-[11px] text-[var(--label)]">
            {window.windowMinutes >= 1440
              ? `${Math.round(window.windowMinutes / 1440)}d`
              : `${Math.round(window.windowMinutes / 60)}h`}
          </span>
        )}
      </div>
    </section>
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
      <div className="page-layout">
        <div className="page-header">
          <div className="h-6 w-28 rounded-md bg-[var(--button-fill)] animate-pulse" />
        </div>
        <div className="page-body gap-4">
          <div className="h-24 rounded-[14px] bg-[var(--button-fill)]/70 animate-pulse" />
          <div className="grid grid-cols-1 @min-[560px]/page:grid-cols-2 gap-3.5">
            <div className="h-36 rounded-[14px] bg-[var(--button-fill)]/70 animate-pulse" />
            <div className="h-36 rounded-[14px] bg-[var(--button-fill)]/70 animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  const activeAccount = accounts.find((a) => a.id === activeAccountId);

  if (!activeAccount) {
    return (
      <div className="page-layout">
        <PageHeader title="当前账号" />
        <div className="page-body">
          <div className="bento-empty flex-1">
            <div className="mb-3.5 grid size-11 place-items-center rounded-[12px] bg-[var(--button-fill)] text-muted-foreground">
              <CircleAlert size={20} />
            </div>
            <h3 className="text-title font-semibold text-foreground">未设置活跃账号</h3>
            <p className="mt-1.5 mb-5 max-w-sm text-body text-muted-foreground leading-relaxed">
              当前没有正在使用的 Codex 账号配置。前往账号管理页面启用或添加订阅账号。
            </p>
            <SchedulePreview accounts={accounts} isEmailMaskingEnabled={isEmailMaskingEnabled} className="mb-4 max-w-full" />
            <Button onClick={onNavigateToAccounts} size="sm" className="gap-1.5">
              <span>前往账号管理</span>
              <ArrowRight size={14} />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const usageWindows: Array<{
    window: AccountUsageWindow;
    kind: 'primary' | 'secondary';
  }> = [];
  const isApiKey = isApiKeyAccount(activeAccount);
  const { usage: currentUsage, isLive: displayingLive } = resolveCurrentUsage(activeAccount, liveUsage);
  if (currentUsage?.primary) {
    usageWindows.push({ window: currentUsage.primary, kind: 'primary' });
  }
  if (currentUsage?.secondary) {
    usageWindows.push({ window: currentUsage.secondary, kind: 'secondary' });
  }
  const usageRefreshing = syncingUsage || (liveUsage.accountId === activeAccount.id && liveUsage.isRefreshing);
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
    <div className="page-layout">
      <PageHeader
        title="当前账号"
        badge={currentUsage && (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <span className="bento-status-dot" data-tone="running" aria-hidden="true" />
            {displayingLive
              ? liveUsage.source === 'push'
                ? '实时推送'
                : liveUsage.source === 'manualRead'
                  ? '手动读取'
                  : '初始额度'
              : '已同步额度'}
            {' · '}
            {formatUsageSyncedAt(currentUsage.syncedAt)}
          </span>
        )}
        actions={
          <>
            {!isApiKey && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleRefreshUsage()}
                disabled={usageRefreshing}
              >
                <RefreshCw size={13} className={usageRefreshing ? 'animate-spin' : ''} />
                {usageRefreshing ? '刷新中…' : '刷新额度'}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onNavigateToAccounts}>
              <Users size={13} />
              账号管理
            </Button>
          </>
        }
      />

      <div className="page-scroll flex flex-col gap-4">
        {/* 账号身份一体化分组卡片 */}
        <section aria-label="账号信息" className="bento-group shrink-0 overflow-hidden">
          <div className="flex items-center justify-between gap-4 px-[18px] py-4">
            <div className="flex min-w-0 items-center gap-3.5">
              <div className="relative grid size-10 shrink-0 place-items-center rounded-[10px] bg-[var(--button-fill)] text-foreground select-none">
                {avatarLetter ? (
                  <span className="text-[15px] font-semibold">{avatarLetter}</span>
                ) : (
                  <User size={17} />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="break-all text-title font-semibold tracking-[-0.01em] text-foreground leading-5 select-text">
                    {getDisplayedEmail(activeAccount.name, isEmailMaskingEnabled)}
                  </h3>
                  <ActionTooltip label={copied ? '已复制' : '复制账号'}>
                    <button
                      type="button"
                      onClick={handleCopyEmail}
                      className="grid size-6 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-foreground"
                      aria-label="复制账号"
                    >
                      {copied ? (
                        <Check size={13} strokeWidth={2.5} className="text-success" />
                      ) : (
                        <Copy size={13} />
                      )}
                    </button>
                  </ActionTooltip>
                  <PlanBadge planType={activeAccount.chatgptPlanType} accountType={activeAccount.accountType} />
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-2 text-label text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5 text-foreground">
                    <span className="bento-status-dot" data-tone="running" aria-hidden="true" />
                    当前生效
                  </span>
                  <span className="text-[var(--label)]">·</span>
                  {activeAccount.notes ? (
                    <span className="truncate" title={activeAccount.notes}>
                      {activeAccount.notes}
                    </span>
                  ) : (
                    <span>{isApiKey ? 'OpenAI 官方 API Key 凭据' : 'Codex 活跃会话凭据'}</span>
                  )}
                  {activeAccount.resetCredits && (
                    <>
                      <span className="text-[var(--label)]">·</span>
                      <span className="font-medium text-foreground">
                        重置卡 ×{activeAccount.resetCredits.availableCount}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-[var(--hairline-divider)] px-[18px] py-2.5">
            <SchedulePreview accounts={accounts} isEmailMaskingEnabled={isEmailMaskingEnabled} />
          </div>
        </section>

        {/* 错误提示 */}
        {!isApiKey && displayedUsageError && (
          <div
            role="alert"
            className="bento-card flex items-start gap-2.5 px-4 py-3 text-label text-destructive"
          >
            <span className="bento-status-dot mt-1.5" data-tone="error" aria-hidden="true" />
            <span className="flex-1 break-all">{displayedUsageError}</span>
          </div>
        )}

        {/* 额度数据看板 */}
        {isApiKey ? (
          <section className="bento-group px-[18px] py-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-subtitle font-semibold text-foreground">官方 API · 按量计费</p>
              <code className="text-label text-muted-foreground">{maskApiKey(getAccountApiKey(activeAccount))}</code>
            </div>
            <p className="mt-1.5 text-label leading-relaxed text-muted-foreground">
              当前费用计入你的 OpenAI Platform 账户，可在账号管理中测试 Key，或在「Token 用量」中查看本地会话消耗。
            </p>
          </section>
        ) : usageWindows.length > 0 ? (
          <div
            className={`grid grid-cols-1 ${
              usageWindows.length > 1 ? '@min-[560px]/page:grid-cols-2' : ''
            } gap-3.5`}
          >
            {usageWindows.map(({ window, kind }) => (
              <UsageCard key={kind} window={window} kind={kind} />
            ))}
          </div>
        ) : (
          <div className="bento-empty py-10">
            <ChartLine size={22} strokeWidth={1.5} className="mb-2.5 text-[var(--label)]" />
            <p className="text-subtitle font-medium text-foreground">
              {usageRefreshing ? '正在更新额度…' : currentUsage ? '暂未同步到额度明细' : '等待当前账号额度'}
            </p>
            <p className="mt-1 max-w-sm text-label leading-relaxed text-muted-foreground">
              使用本地会话后同步即可更新额度，实时监听可用时会自动接收推送。
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
