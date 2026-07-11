// Static pricing table for cost estimation.
// Hand-maintained — update when provider pricing changes.
// Returns null for unknown models (UI shows "—" instead of $0).

interface ModelPrice {
  provider: string;
  model: string;
  inputPer1kUsd: number;
  outputPer1kUsd: number;
}

// Prices per 1K tokens (input/output) in USD.
// Sources: each provider's published pricing page as of 2026-07.
const PRICING: ModelPrice[] = [
  // Anthropic
  { provider: "anthropic",   model: "claude-sonnet-4-6",        inputPer1kUsd: 0.003,  outputPer1kUsd: 0.015 },
  { provider: "anthropic",   model: "claude-sonnet-4-20250514", inputPer1kUsd: 0.003,  outputPer1kUsd: 0.015 },
  { provider: "anthropic",   model: "claude-haiku-3-5",         inputPer1kUsd: 0.001,  outputPer1kUsd: 0.005 },

  // NVIDIA (Kimi K2)
  { provider: "nvidia",      model: "moonshotai/kimi-k2.6",     inputPer1kUsd: 0.002,  outputPer1kUsd: 0.008 },

  // OpenAI
  { provider: "openai",      model: "gpt-4o",                   inputPer1kUsd: 0.005,  outputPer1kUsd: 0.015 },
  { provider: "openai",      model: "gpt-4o-mini",              inputPer1kUsd: 0.0005, outputPer1kUsd: 0.0015 },

  // Google Vertex / Gemini
  { provider: "google_vertex_proxy", model: "gemini-2.5-flash-lite", inputPer1kUsd: 0.0003, outputPer1kUsd: 0.0006 },
  { provider: "google",      model: "gemini-2.5-flash-lite",    inputPer1kUsd: 0.0003, outputPer1kUsd: 0.0006 },

  // GLM (Zhipu)
  { provider: "glm",         model: "glm-4-plus",              inputPer1kUsd: 0.001,  outputPer1kUsd: 0.001 },
];

export function estimateCost(
  provider: string,
  model: string | null | undefined,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined
): number | null {
  if (!inputTokens && !outputTokens) return null;
  const resolvedModel = model ?? "";
  const entry = PRICING.find(
    (p) => p.provider === provider && p.model.toLowerCase() === resolvedModel.toLowerCase()
  );
  if (!entry) return null;

  let cost = 0;
  if (inputTokens) cost += (inputTokens / 1000) * entry.inputPer1kUsd;
  if (outputTokens) cost += (outputTokens / 1000) * entry.outputPer1kUsd;
  return Math.round(cost * 100000) / 100000;
}

export function listPricingModels(): ModelPrice[] {
  return PRICING;
}
