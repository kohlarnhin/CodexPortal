import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Account, AccountStore, AccountFormData } from '../types/account';

export function useAccounts() {
  const [store, setStore] = useState<AccountStore>({ activeAccountId: null, accounts: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAccounts = useCallback(async (showLoading: boolean = true) => {
    try {
      if (showLoading) setIsLoading(true);
      setError(null);
      const data = await invoke<AccountStore>('get_accounts');
      setStore(data);
    } catch (err: any) {
      console.error('Failed to load accounts:', err);
      setError(err?.toString() || 'Failed to load accounts');
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const addAccount = async (data: AccountFormData) => {
    try {
      const newAccount = await invoke<Account>('add_account', { 
        name: data.name, 
        authJsonContent: data.authJsonContent, 
        notes: data.notes || null,
        planType: data.planType
      });
      await loadAccounts(false);
      return newAccount;
    } catch (err: any) {
      console.error('Failed to add account:', err);
      throw err;
    }
  };

  const updateAccount = async (id: string, data: AccountFormData) => {
    try {
      const updatedAccount = await invoke<Account>('update_account', { 
        id, 
        name: data.name, 
        authJsonContent: data.authJsonContent, 
        notes: data.notes || null,
        planType: data.planType
      });
      await loadAccounts(false);
      return updatedAccount;
    } catch (err: any) {
      console.error('Failed to update account:', err);
      throw err;
    }
  };

  const deleteAccount = async (id: string) => {
    try {
      await invoke('delete_account', { id });
      await loadAccounts(false);
    } catch (err: any) {
      console.error('Failed to delete account:', err);
      throw err;
    }
  };

  const setActiveAccount = async (id: string) => {
    try {
      await invoke('set_active_account', { id });
      await loadAccounts(false);
    } catch (err: any) {
      console.error('Failed to set active account:', err);
      throw err;
    }
  };

  return {
    accounts: store.accounts,
    activeAccountId: store.activeAccountId,
    isLoading,
    error,
    addAccount,
    updateAccount,
    deleteAccount,
    setActiveAccount,
    refresh: loadAccounts
  };
}
