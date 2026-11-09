import type { Account } from '../types/account';
import { getRemainingPercent } from './accountUsage';

export type AccountSortField = 'default' | 'remaining' | 'reset' | 'name' | 'created';
export type AccountSortDirection = 'asc' | 'desc';
export interface AccountSortPreference {
  field: AccountSortField;
  direction: AccountSortDirection;
}

const SORT_STORAGE_KEY = 'codex-portal.accounts.sort';

export const DEFAULT_SORT_DIRECTIONS: Record<AccountSortField, AccountSortDirection> = {
  default: 'asc',
  remaining: 'desc',
  reset: 'asc',
  name: 'asc',
  created: 'desc',
};

export function readAccountSort(): AccountSortPreference {
  try {
    const saved = JSON.parse(localStorage.getItem(SORT_STORAGE_KEY) || 'null');
    if (saved && typeof saved.field === 'string' && Object.prototype.hasOwnProperty.call(DEFAULT_SORT_DIRECTIONS, saved.field)
      && (saved.direction === 'asc' || saved.direction === 'desc')) {
      return { field: saved.field, direction: saved.field === 'default' ? 'asc' : saved.direction };
    }
  } catch {
    // 无效或不可用的本地偏好不影响账号列表。
  }
  return { field: 'default', direction: 'asc' };
}

export function saveAccountSort(preference: AccountSortPreference): void {
  try {
    localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(preference));
  } catch {
    // 存储不可用时，当前页面仍可排序。
  }
}

function effectiveRemaining(account: Account, now: number): number | null {
  if (account.authMethod === 'api_key' || !account.usage) return null;
  const values = [account.usage.primary, account.usage.secondary].flatMap(window => {
    if (!window) return [];
    const remaining = getRemainingPercent(window);
    if (remaining === null) return [];
    return [window.resetsAt !== null && Number.isFinite(window.resetsAt) && window.resetsAt <= now ? 100 : remaining];
  });
  return values.length ? Math.min(...values) : null;
}

function sortValue(account: Account, field: AccountSortField, now: number): number | null {
  if (field === 'remaining') return effectiveRemaining(account, now);
  if (field === 'reset') {
    const reset = account.authMethod === 'api_key' ? null : account.usage?.primary?.resetsAt;
    return reset != null && Number.isFinite(reset) && reset > now ? reset : null;
  }
  const created = Date.parse(account.createdAt);
  return Number.isFinite(created) ? created : null;
}

/** 返回副本；未知值始终置后，同值保持后端顺序。now 为秒。 */
export function sortAccounts(
  accounts: Account[],
  { field, direction }: AccountSortPreference,
  now = Date.now() / 1_000,
): Account[] {
  if (field === 'default') return [...accounts];
  const sign = direction === 'asc' ? 1 : -1;
  return accounts.map((account, index) => ({ account, index, value: sortValue(account, field, now) }))
    .sort((a, b) => {
      if (field === 'name') {
        return sign * a.account.name.localeCompare(b.account.name, 'zh-CN') || a.index - b.index;
      }
      if (a.value === null) return b.value === null ? a.index - b.index : 1;
      if (b.value === null) return -1;
      return sign * (a.value - b.value) || a.index - b.index;
    })
    .map(({ account }) => account);
}
