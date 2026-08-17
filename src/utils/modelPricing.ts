/**
 * OpenAI 官方 API 标准价（每 1M tokens，USD，短上下文）。
 * 来源：https://developers.openai.com/api/docs/pricing
 * 推理 token（reasoning）无单独档位，按输出价计费。
 * 长上下文（>272K 输入）另有溢价，Codex 会话极少触及，此处不展开。
 */
interface ModelPricing {
  inputPer1M: number;
  cachedInputPer1M: number;
  outputPer1M: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-5.6-sol': { inputPer1M: 5.0, cachedInputPer1M: 0.5, outputPer1M: 30.0 },
  'gpt-5.6-terra': { inputPer1M: 2.0, cachedInputPer1M: 0.2, outputPer1M: 12.0 },
  'gpt-5.6-luna': { inputPer1M: 0.2, cachedInputPer1M: 0.02, outputPer1M: 1.2 },
  'gpt-5.5': { inputPer1M: 5.0, cachedInputPer1M: 0.5, outputPer1M: 30.0 },
};

/** 按模型名查找价格：先精确匹配，再按前缀匹配变体（如 gpt-5.6-sol-chat）。 */
function findPricing(model: string): ModelPricing | null {
  const exact = MODEL_PRICING[model];
  if (exact) return exact;
  const lower = model.toLowerCase();
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (lower.startsWith(key)) return pricing;
  }
  return null;
}

export interface TokenCostInput {
  input: number;
  cachedInput: number;
  output: number;
  reasoning: number;
}

/** 计算单个模型的消耗金额（USD）；价格未知的模型返回 null（不计入总额）。 */
export function calcModelCost(model: string, tokens: TokenCostInput): number | null {
  const pricing = findPricing(model);
  if (!pricing) return null;
  // input 累计值已包含缓存命中部分：非缓存部分按全价、缓存部分按缓存价，避免重复计费。
  const uncachedInput = Math.max(0, tokens.input - tokens.cachedInput);
  return (
    (uncachedInput * pricing.inputPer1M +
      tokens.cachedInput * pricing.cachedInputPer1M +
      (tokens.output + tokens.reasoning) * pricing.outputPer1M) /
    1_000_000
  );
}

/** 金额格式化：两位小数，大额取整。 */
export function formatCost(cost: number): string {
  if (cost >= 100) return `$${Math.round(cost)}`;
  return `$${cost.toFixed(2)}`;
}

/**
 * 窗口快照的金额估算：快照无模型维度，按主流模型 gpt-5.6-sol 单价估算。
 * 输入累计值已含缓存命中部分，非缓存部分按全价、缓存部分按缓存价，避免重复计费。
 */
export function calcSnapshotCost(snapshot: {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}): number {
  const pricing = MODEL_PRICING['gpt-5.6-sol'];
  const uncachedInput = Math.max(0, snapshot.inputTokens - snapshot.cachedInputTokens);
  return (
    (uncachedInput * pricing.inputPer1M +
      snapshot.cachedInputTokens * pricing.cachedInputPer1M +
      (snapshot.outputTokens + snapshot.reasoningTokens) * pricing.outputPer1M) /
    1_000_000
  );
}
