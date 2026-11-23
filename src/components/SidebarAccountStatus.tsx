import React, { useEffect } from 'react';
import { UserPlus } from 'lucide-react';
import { useAccounts } from '../hooks/useAccounts';
import type { CodexLiveUsage } from '../types/codexEvents';
import type { AccountUsageWindow } from '../types/account';
import { getDisplayedEmail } from '../utils/accountEmail';
import { isApiKeyAccount } from '../utils/accountAuth';
import {
  formatUsageWindowLabel,
  getRemainingPercent,
  getUsageTone,
  resolveCurrentUsage,
  USAGE_TONE_FILL,
} from '../utils/accountUsage';
import { cn } from '../lib/utils';
import PlanBadge from './PlanBadge';

interface SidebarAccountStatusProps {
  isEmailMaskingEnabled: boolean;
  usageRevision: number;
  liveUsage: CodexLiveUsage;
  onOpenDashboard: () => void;
  onOpenAccounts: () => void;
}

const MiniMeter = ({ window, kind }: { window: AccountUsageWindow; kind: 'primary' | 'secondary' }) => {
  const remaining = getRemainingPercent(window);
  const label = formatUsageWindowLabel(window, kind);
  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-[11.5px] leading-4">
        <span className="truncate text-[var(--label)]">{label}</span>
        <span className="shrink-0 font-medium tabular-nums text-foreground">
          {remaining === null ? '—' : `${Math.round(remaining)}%`}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`${label}剩余`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={remaining ?? undefined}
        className="mt-1 h-[3.5px] overflow-hidden rounded-full bg-[var(--button-fill)]"
      >
        <div
          className={cn('h-full rounded-full transition-all duration-500', USAGE_TONE_FILL[getUsageTone(remaining)])}
          style={{ width: `${remaining ?? 0}%` }}
        />
      </div>
    </div>
  );
};

/** 侧边栏底部：当前账号与额度速览（Bento 卡片样式）。 */
const SidebarAccountStatus: React.FC<SidebarAccountStatusProps> = ({
  isEmailMaskingEnabled,
  usageRevision,
  liveUsage,
  onOpenDashboard,
  onOpenAccounts,
}) => {
  const { accounts, activeAccountId, isLoading, refresh } = useAccounts();

  useEffect(() => {
    if (usageRevision > 0) void refresh(false);
  }, [refresh, usageRevision]);

  if (isLoading) {
    return <div className="h-[88px] animate-pulse rounded-[12px] bg-[var(--button-fill)]/70" />;
  }

  const account = accounts.find(item => item.id === activeAccountId);
  if (!account) {
    return (
      <button
        type="button"
        data-no-press
        onClick={onOpenAccounts}
        className="flex w-full cursor-pointer items-center gap-2.5 rounded-[12px] border border-dashed border-[var(--hairline-control)] px-3 py-2.5 text-left text-label text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-foreground"
      >
        <UserPlus size={14} className="shrink-0" />
        未设置当前账号
      </button>
    );
  }

  const { usage } = resolveCurrentUsage(account, liveUsage);

  return (
    <button
      type="button"
      data-no-press
      onClick={onOpenDashboard}
      aria-label="查看当前账号"
      className="bento-card w-full cursor-pointer rounded-[13px] px-3.5 py-3 text-left outline-none transition-colors hover:bg-[var(--hover)] focus-visible:ring-2 focus-visible:ring-ring/25"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="bento-status-dot" data-tone="running" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
          {getDisplayedEmail(account.name, isEmailMaskingEnabled)}
        </span>
        <PlanBadge planType={account.chatgptPlanType} accountType={account.accountType} />
      </div>
      {isApiKeyAccount(account) ? (
        <p className="mt-1.5 text-[11.5px] text-[var(--label)]">官方 API · 按量计费</p>
      ) : usage?.primary || usage?.secondary ? (
        <div className="mt-2.5 space-y-2">
          {usage.primary && <MiniMeter window={usage.primary} kind="primary" />}
          {usage.secondary && <MiniMeter window={usage.secondary} kind="secondary" />}
        </div>
      ) : (
        <p className="mt-1.5 text-[11.5px] text-[var(--label)]">等待额度同步</p>
      )}
    </button>
  );
};

export default SidebarAccountStatus;
