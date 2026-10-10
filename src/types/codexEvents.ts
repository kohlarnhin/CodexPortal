import type { AccountUsage } from './account';

export interface CodexEventContext {
  accountId: string | null;
  epoch: number;
  switching: boolean;
}

export interface CodexActiveSession {
  id: string;
  cwd: string | null;
  name: string | null;
  status: 'active' | 'idle' | 'systemError' | 'unknown';
  activeFlags: string[];
  lastActivityAt: number;
}

export interface CodexLiveUsage {
  accountId: string | null;
  usage: AccountUsage | null;
  source: 'initialRead' | 'push' | 'manualRead' | null;
  isRefreshing: boolean;
  error: string | null;
}

export interface CodexSessionMonitor {
  connectionStatus: 'connecting' | 'connected' | 'reconnecting';
  activeCount: number | null;
  sessions: CodexActiveSession[];
  isRefreshing: boolean;
  discoveryFailed: boolean;
  lastSyncedAt: number | null;
  quotaPushCount: number;
  lastQuotaPushAt: number | null;
}
