import { AccountUsageWindow } from '../types/account';

export function getRemainingPercent(window: AccountUsageWindow): number {
  const usedPercent = Number.isFinite(window.usedPercent) ? window.usedPercent : 0;
  return Math.max(0, Math.min(100, 100 - usedPercent));
}

export function formatUsageWindowLabel(
  window: AccountUsageWindow,
  fallback: 'primary' | 'secondary',
): string {
  const minutes = window.windowMinutes;
  if (!minutes || minutes <= 0) {
    return fallback === 'primary' ? '短周期额度' : '长周期额度';
  }
  if (minutes === 300) return '5 小时额度';
  if (minutes === 10_080) return '周额度';
  if (minutes >= 38_880 && minutes <= 46_080) return '月额度';
  if (minutes % 1_440 === 0) return `${minutes / 1_440} 天额度`;
  if (minutes % 60 === 0) return `${minutes / 60} 小时额度`;
  return `${minutes} 分钟额度`;
}

export function formatUsageResetAt(resetsAt: number | null): string {
  if (!resetsAt) return '重置时间未知';
  const resetDate = new Date(resetsAt * 1_000);
  if (Number.isNaN(resetDate.getTime())) return '重置时间未知';

  return `${new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(resetDate)} 重置`;
}

export function formatUsageSyncedAt(syncedAt: string): string {
  const syncedDate = new Date(syncedAt);
  if (Number.isNaN(syncedDate.getTime())) return '更新时间未知';

  return `更新于 ${new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(syncedDate)}`;
}
