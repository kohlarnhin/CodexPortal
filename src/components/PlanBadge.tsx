import type { Account } from '../types/account';

/**
 * 账号订阅类型铭牌（Bento 克制单色胶囊风格）。
 */
const PLAN_META: Record<string, { label: string; className: string }> = {
  openai_api_key: { label: 'OpenAI API', className: 'bg-[var(--button-fill)] text-foreground border-transparent' },
  team: { label: 'Team', className: 'bg-primary text-primary-foreground border-transparent' },
  business: { label: 'Business', className: 'bg-primary text-primary-foreground border-transparent' },
  enterprise: { label: 'Enterprise', className: 'bg-primary text-primary-foreground border-transparent' },
  pro: { label: 'Pro', className: 'bg-transparent text-foreground border-[var(--hairline-selection)]' },
  plus: { label: 'Plus', className: 'bg-[var(--button-fill)] text-foreground border-transparent' },
  free: { label: 'Free', className: 'bg-transparent text-muted-foreground border-[var(--hairline-control)]' },
  edu: { label: 'Edu', className: 'bg-[var(--button-fill)] text-foreground border-transparent' },
};

export default function PlanBadge({ planType, accountType }: { planType?: string | null; accountType?: Account['accountType'] }) {
  const key = accountType === 'openai_api_key' ? accountType : (planType || '').toLowerCase();
  const meta = PLAN_META[key];

  if (!meta) {
    if (!planType) return null;
    return (
      <span className="shrink-0 inline-flex items-center rounded-full border border-[var(--hairline-control)] px-2 py-0.5 text-[10.5px] leading-tight font-medium text-muted-foreground">
        {planType}
      </span>
    );
  }

  return (
    <span className={`shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] leading-tight font-medium ${meta.className}`}>
      {meta.label}
    </span>
  );
}
