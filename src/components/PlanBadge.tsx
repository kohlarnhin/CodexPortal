import React from 'react';

/**
 * 账号订阅类型铭牌（team/plus/pro/free 等）。
 * 来自 whoami 返回的 chatgpt_plan_type。
 */

const PLAN_META: Record<string, { label: string; className: string }> = {
  team: { label: 'Team', className: 'bg-black text-white border-black' },
  business: { label: 'Business', className: 'bg-black text-white border-black' },
  enterprise: { label: 'Enterprise', className: 'bg-black text-white border-black' },
  pro: { label: 'Pro', className: 'bg-[#FFF6E5] text-[#B45309] border-[#F2D08A]' },
  plus: { label: 'Plus', className: 'bg-[#EFF4FF] text-[#2563EB] border-[#BFD2FF]' },
  free: { label: 'Free', className: 'bg-[#F5F5F5] text-[#888888] border-[#E0E0E0]' },
  edu: { label: 'Edu', className: 'bg-emerald-50 text-emerald-600 border-emerald-200' },
};

export default function PlanBadge({ planType }: { planType?: string | null }) {
  const key = (planType || '').toLowerCase();
  const meta = PLAN_META[key];

  if (!meta) {
    if (!planType) return null;
    return (
      <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 border border-[#E0E0E0] bg-[#F5F5F5] text-[#888888] rounded-full text-[9px] font-bold tracking-wider">
        {planType}
      </span>
    );
  }

  return (
    <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 border rounded-full text-[9px] font-bold tracking-wider ${meta.className}`}>
      {meta.label}
    </span>
  );
}
