export interface AccountUsageWindow {
  usedPercent: number;
  windowMinutes: number | null;
  resetsAt: number | null;
}

export interface AccountUsage {
  primary: AccountUsageWindow | null;
  secondary: AccountUsageWindow | null;
  syncedAt: string;
}

export interface Account {
  id: string;
  name: string;
  authJsonContent: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  planType: 'weekly' | 'monthly';
  usage: AccountUsage | null;
  canRefreshUsage: boolean;
  nextRefreshAt?: string | null;
}

export interface AccountStore {
  activeAccountId: string | null;
  accounts: Account[];
}

export interface AccountFormData {
  name: string;
  authJsonContent: string;
  notes: string;
  planType: 'weekly' | 'monthly';
}
