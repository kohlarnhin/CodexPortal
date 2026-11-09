import type { Account } from '../types/account';

export function isApiKeyAccount(account: Pick<Account, 'accountType'>): boolean {
  return account.accountType === 'openai_api_key';
}

export function getAccountApiKey(account: Pick<Account, 'authJsonContent'>): string {
  try {
    const auth = JSON.parse(account.authJsonContent);
    return typeof auth.OPENAI_API_KEY === 'string' ? auth.OPENAI_API_KEY : '';
  } catch {
    return '';
  }
}

export function maskApiKey(key: string): string {
  return key ? `•••• ${key.slice(-4)}` : '••••';
}
