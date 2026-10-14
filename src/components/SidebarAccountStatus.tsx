import React, { useEffect } from 'react';
import { UserPlus } from 'lucide-react';
import { useAccounts } from '../hooks/useAccounts';
import type { CodexLiveUsage } from '../types/codexEvents';
import type { AccountUsageWindow } from '../types/account';
import { getDisplayedEmail } from '../utils/accountEmail';
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
      <div className="flex items-center justify-between gap-2 text-caption">
        <span className="truncate text-muted-foreground">{label}</span>
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
        className="mt-1 h-1 overflow-hidden rounded-full bg-primary/10"
      >
        <div
          className={cn('h-full rounded-full transition-all duration-500', USAGE_TONE_FILL[getUsageTone(remaining)])}
          style={{ width: `${remaining ?? 0}%` }}
        />
      </div>
    </div>
  );
};

/** 侧边栏底部：当前账号与额度速览，任意页面都能看到剩余额度。 */
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
    return <div className="h-[92px] animate-pulse rounded-lg bg-muted/60" />;
  }

  const account = accounts.find(item => item.id === activeAccountId);
  if (!account) {
    return (
      <button
        type="button"
        onClick={onOpenAccounts}
        className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg border border-dashed px-3 py-2.5 text-left text-label text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
      >
        <UserPlus size={15} className="shrink-0" />
        未设置当前账号
      </button>
    );
  }

  const { usage } = resolveCurrentUsage(account, liveUsage);

  return (
    <button
      type="button"
      onClick={onOpenDashboard}
      aria-label="查看当前账号额度"
      className="w-full cursor-pointer rounded-lg border bg-card px-3 py-2.5 text-left shadow-xs outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-label font-medium text-foreground">
          {getDisplayedEmail(account.name, isEmailMaskingEnabled)}
        </span>
        <PlanBadge planType={account.chatgptPlanType} />
      </div>
      {usage?.primary || usage?.secondary ? (
        <div className="mt-2 space-y-1.5">
          {usage.primary && <MiniMeter window={usage.primary} kind="primary" />}
          {usage.secondary && <MiniMeter window={usage.secondary} kind="secondary" />}
        </div>
      ) : (
        <p className="mt-1.5 text-caption text-muted-foreground">等待额度同步</p>
      )}
    </button>
  );
};

export default SidebarAccountStatus;
