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
  chatgptPlanType?: string | null;
  hasAccessToken: boolean;
  resetCredits: ResetCreditsInfo | null;
}

export interface ResetCredit {
  id?: string | null;
  status?: string | null;
  resetType?: string | null;
  expiresAt?: number | null;
  grantedAt?: number | null;
  redeemedAt?: number | null;
}

export interface ResetCreditsInfo {
  availableCount: number;
  credits: ResetCredit[];
  syncedAt: string;
}

export interface AccountStore {
  activeAccountId: string | null;
  accounts: Account[];
}

export interface AccountFormData {
  token: string;
  notes: string;
}

export interface TokenInfo {
  email: string;
  chatgptPlanType: string;
}

export interface RtTokenInfo {
  email: string;
  chatgptPlanType?: string | null;
  chatgptAccountId?: string | null;
  accessToken: string;
  refreshToken: string;
  atExpiresAt: number;
}

export interface SaveRtAccountParams {
  email: string;
  chatgptPlanType?: string | null;
  chatgptAccountId?: string | null;
  accessToken: string;
  refreshToken: string;
  atExpiresAt: number;
  notes?: string;
}

export interface OAuthLoginInfo {
  url: string;
  redirectUri: string;
}

export interface TestMessageResult {
  model: string;
  input: string;
  output: string;
}

/** 账号窗口额度（进行中的当前窗口实时计算，其余为切换快照，均按周期增量展示）。 */
export interface AccountWindowSnapshot {
  switchedAt: string;
  planType: string | null;
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** 是否为进行中的当前窗口。 */
  isActive: boolean;
  /** 窗口起点 used_percent（进行中窗口为开段时的额度）。 */
  startUsedPercent: number | null;
  /** 保存的推算窗口总额（USD，历史快照；进行中窗口为 null 由前端实时推算）。 */
  windowTotalCost: number | null;
  /** 窗口开始时间（历史快照；进行中窗口为 null）。 */
  windowStartAt: string | null;
}
