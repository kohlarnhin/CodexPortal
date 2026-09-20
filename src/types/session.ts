export interface SessionProject {
  path: string;
  name: string;
  sessionCount: number;
  totalTokens: number;
  firstSessionAt: string | null;
  lastSessionAt: string | null;
}

export interface SessionRecord {
  id: string;
  projectPath: string;
  filePath: string;
  title: string;
  startedAt: string;
  lastActivityAt: string | null;
  modelProvider: string | null;
  cliVersion: string | null;
  fileSize: number;
  messageCount: number;
  model: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export interface SessionListPage {
  sessions: SessionRecord[];
  total: number;
}

export interface SessionSyncResult {
  total: number;
  imported: number;
  updated: number;
  removed: number;
  skipped: number;
  failed: number;
  projects: number;
  syncedAt: string;
}

export interface SessionSyncStatus {
  isSyncing: boolean;
  lastSyncedAt: string | null;
  nextSyncAt: string | null;
  totalProjects: number;
  totalSessions: number;
}

/** 会话日志中的一条完整记录，按原始行顺序保留。 */
export interface SessionEntry {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  title: string;
  timestamp: string | null;
  text: string;
  raw: string;
  defaultCollapsed: boolean;
}

/** 某日按项目聚合的 token 用量。 */
export interface ProjectTokenUsage {
  projectPath: string;
  name: string;
  sessionCount: number;
  totalTokens: number;
}

/** 某日按模型聚合的 token 用量。 */
export interface ModelTokenUsage {
  model: string;
  sessionCount: number;
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

/** 某一天的 token 用量（含项目/模型分布）。 */
export interface DailyTokenUsage {
  date: string;
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  projects: ProjectTokenUsage[];
  models: ModelTokenUsage[];
}
