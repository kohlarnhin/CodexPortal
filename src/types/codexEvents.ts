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

// 仅用于当前账号的内存展示，不参与额度缓存或会话入库。
export interface CodexLiveTps {
  accountId: string | null;
  threadId: string | null;
  tokensPerSecond: number | null;
  outputTokens: number | null;
  durationMs: number | null;
  status: 'waiting' | 'measuring' | 'completed';
}

export interface CodexSessionMonitor {
  connectionStatus: 'connecting' | 'connected' | 'unavailable';
  activeCount: number | null;
  sessions: CodexActiveSession[];
  isRefreshing: boolean;
  discoveryFailed: boolean;
  lastSyncedAt: number | null;
  quotaPushCount: number;
  lastQuotaPushAt: number | null;
}
