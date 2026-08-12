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
  lastSyncedAt: string | null;
  nextSyncAt: string | null;
  totalProjects: number;
  totalSessions: number;
}

/** 会话内容预览中提取出的一条消息。 */
export interface SessionPreviewMessage {
  role: 'user' | 'assistant';
  text: string;
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
}

/** 某一天的 token 用量（含项目/模型分布）。 */
export interface DailyTokenUsage {
  date: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  projects: ProjectTokenUsage[];
  models: ModelTokenUsage[];
}
