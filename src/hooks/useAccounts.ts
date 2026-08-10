import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Account, AccountStore, AccountFormData, OAuthLoginInfo, ResetCreditsInfo, RtTokenInfo, SaveRtAccountParams, TokenInfo } from '../types/account';

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
        token: data.token,
        notes: data.notes || null
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
        token: data.token,
        notes: data.notes || null
      });
      await loadAccounts(false);
      return updatedAccount;
    } catch (err: any) {
      console.error('Failed to update account:', err);
      throw err;
    }
  };

  const validatePersonalToken = async (token: string): Promise<TokenInfo> => {
    return await invoke<TokenInfo>('validate_personal_token', { token });
  };

  const exchangeRefreshToken = async (input: string): Promise<RtTokenInfo> => {
    return await invoke<RtTokenInfo>('exchange_refresh_token', { input });
  };

  const startOauthLogin = async (): Promise<OAuthLoginInfo> => {
    return await invoke<OAuthLoginInfo>('start_oauth_login');
  };

  const checkOauthCallback = async (): Promise<RtTokenInfo | null> => {
    return await invoke<RtTokenInfo | null>('check_oauth_callback');
  };

  const completeOauthLogin = async (redirectUrl: string): Promise<RtTokenInfo> => {
    return await invoke<RtTokenInfo>('complete_oauth_login', { redirectUrl });
  };

  const saveRtAccount = async (params: SaveRtAccountParams): Promise<Account> => {
    const account = await invoke<Account>('save_rt_account', {
      email: params.email,
      chatgptPlanType: params.chatgptPlanType ?? null,
      chatgptAccountId: params.chatgptAccountId ?? null,
      accessToken: params.accessToken,
      refreshToken: params.refreshToken,
      atExpiresAt: params.atExpiresAt,
      notes: params.notes ?? null,
    });
    await loadAccounts(false);
    return account;
  };

  const setAccountAccessToken = async (id: string, accessToken: string) => {
    try {
      await invoke('set_account_access_token', { id, accessToken });
      await loadAccounts(false);
    } catch (err: any) {
      console.error('Failed to save access token:', err);
      throw err;
    }
  };

  const getResetCredits = async (id: string, force = false): Promise<ResetCreditsInfo> => {
    return await invoke<ResetCreditsInfo>('get_reset_credits', { id, force });
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
    validatePersonalToken,
    exchangeRefreshToken,
    saveRtAccount,
    startOauthLogin,
    checkOauthCallback,
    completeOauthLogin,
    setAccountAccessToken,
    getResetCredits,
    refresh: loadAccounts
  };
}
