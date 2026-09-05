import pricingData from './model-pricing.json?raw';

/**
 * OpenAI 官方 API 标准价（每 1M tokens，USD，短上下文）。
 * 来源：https://developers.openai.com/api/docs/pricing
 * 核对日期：2026-09-05。推理 tokens 已包含在 output 中，不重复计费。
 * 会话汇总缺少逐请求上下文长度、服务档位和缓存写入量，仅按标准短上下文估算。
 */
interface ModelPricing {
  inputPer1M: number;
  cachedInputPer1M: number;
  outputPer1M: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = JSON.parse(pricingData);

export const PRICED_MODELS = Object.keys(MODEL_PRICING);

/** 按模型名查找价格：先精确匹配，再匹配聊天别名或日期快照，其他变体保留为未知价格。 */
function findPricing(model: string): ModelPricing | null {
  const lower = model.trim().toLowerCase();
  const exact = Object.prototype.hasOwnProperty.call(MODEL_PRICING, lower) ? MODEL_PRICING[lower] : null;
  if (exact) return exact;
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (lower === `${key}-chat` || new RegExp(`^${key.replace(/\./g, '\\.')}-\\d{4}-\\d{2}-\\d{2}$`).test(lower)) return pricing;
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
      tokens.output * pricing.outputPer1M) /
    1_000_000
  );
}

/** 金额格式化：两位小数，大额取整。 */
export function formatCost(cost: number): string {
  if (cost >= 100) return `$${Math.round(cost)}`;
  return `$${cost.toFixed(2)}`;
}
