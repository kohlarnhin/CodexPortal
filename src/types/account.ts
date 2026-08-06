export interface Account {
  id: string;
  name: string;
  authJsonContent: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  planType: 'weekly' | 'monthly';
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
