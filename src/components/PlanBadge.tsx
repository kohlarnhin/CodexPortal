import React from 'react';

/**
 * 账号订阅类型铭牌（team/plus/pro/free 等）。
 * 来自 whoami 返回的 chatgpt_plan_type。
 */

const PLAN_META: Record<string, { label: string; className: string }> = {
  team: { label: 'Team', className: 'bg-primary text-primary-foreground border-primary' },
  business: { label: 'Business', className: 'bg-primary text-primary-foreground border-primary' },
  enterprise: { label: 'Enterprise', className: 'bg-primary text-primary-foreground border-primary' },
  pro: { label: 'Pro', className: 'bg-warning/10 text-warning border-warning/25' },
  plus: { label: 'Plus', className: 'bg-info/10 text-info border-info/25' },
  free: { label: 'Free', className: 'bg-muted text-muted-foreground border-border' },
  edu: { label: 'Edu', className: 'bg-success/10 text-success border-success/25' },
};

export default function PlanBadge({ planType }: { planType?: string | null }) {
  const key = (planType || '').toLowerCase();
  const meta = PLAN_META[key];

  if (!meta) {
    if (!planType) return null;
    return (
      <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 border border-border bg-muted text-muted-foreground rounded-md text-caption font-medium">
        {planType}
      </span>
    );
  }

  return (
    <span className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 border rounded-md text-caption font-medium ${meta.className}`}>
      {meta.label}
    </span>
  );
}
