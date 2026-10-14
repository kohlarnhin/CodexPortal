import React from 'react';

/**
 * 账号订阅类型铭牌（team/plus/pro/free 等）。
 * 来自 whoami 返回的 chatgpt_plan_type。
 */

const PLAN_META: Record<string, { label: string; className: string }> = {
  team: { label: 'Team', className: 'bg-primary text-primary-foreground border-primary' },
  business: { label: 'Business', className: 'bg-primary text-primary-foreground border-primary' },
  enterprise: { label: 'Enterprise', className: 'bg-primary text-primary-foreground border-primary' },
  pro: { label: 'Pro', className: 'bg-[#FFF6E5] text-[#B45309] border-[#F2D08A]' },
  plus: { label: 'Plus', className: 'bg-[#EFF4FF] text-[#2563EB] border-[#BFD2FF]' },
  free: { label: 'Free', className: 'bg-muted text-muted-foreground border-border' },
  edu: { label: 'Edu', className: 'bg-emerald-50 text-emerald-600 border-emerald-200' },
};

export default function PlanBadge({ planType }: { planType?: string | null }) {
  const key = (planType || '').toLowerCase();
  const meta = PLAN_META[key];

  if (!meta) {
    if (!planType) return null;
    return (
      <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 border border-border bg-muted text-muted-foreground rounded-md text-[10.5px] font-medium">
        {planType}
      </span>
    );
  }

  return (
    <span className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 border rounded-md text-[10.5px] font-medium ${meta.className}`}>
      {meta.label}
    </span>
  );
}
