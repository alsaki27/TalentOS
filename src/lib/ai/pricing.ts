// Static pricing table for cost estimation.
// Hand-maintained — update when provider pricing changes.
// Returns null for unknown models (UI shows "—" instead of $0).
//
// NOTE: Pricing is approximate and should be updated periodically.
// Last reviewed: 2026-07. Sources: each provider's published pricing page.

interface ModelPrice {
  provider: string;
  model: string;
  inputPer1kUsd: number;
  outputPer1kUsd: number;
}

// Prices per 1K tokens (input/output) in USD.
// Unknown-pricing models are omitted; estimateCost returns null for them.
const PRICING: ModelPrice[] = [
  // Anthropic
  { provider: "anthropic",   model: "claude-sonnet-4-6",            inputPer1kUsd: 0.003,  outputPer1kUsd: 0.015 },
  { provider: "anthropic",   model: "claude-sonnet-4-20250514",     inputPer1kUsd: 0.003,  outputPer1kUsd: 0.015 },
  { provider: "anthropic",   model: "claude-opus-4-1",              inputPer1kUsd: 0.015,  outputPer1kUsd: 0.075 },
  { provider: "anthropic",   model: "claude-3-7-sonnet-latest",     inputPer1kUsd: 0.003,  outputPer1kUsd: 0.015 },
  { provider: "anthropic",   model: "claude-3-5-haiku-latest",      inputPer1kUsd: 0.0008, outputPer1kUsd: 0.004 },

  // OpenAI
  { provider: "openai",      model: "gpt-4o",                       inputPer1kUsd: 0.005,  outputPer1kUsd: 0.015 },
  { provider: "openai",      model: "gpt-4o-mini",                  inputPer1kUsd: 0.0005, outputPer1kUsd: 0.0015 },
  { provider: "openai",      model: "gpt-4.1",                      inputPer1kUsd: 0.002,  outputPer1kUsd: 0.008 },
  { provider: "openai",      model: "gpt-4.1-mini",                 inputPer1kUsd: 0.0004, outputPer1kUsd: 0.0016 },
  { provider: "openai",      model: "gpt-4-turbo",                  inputPer1kUsd: 0.01,   outputPer1kUsd: 0.03 },
  { provider: "openai",      model: "o1",                           inputPer1kUsd: 0.015,  outputPer1kUsd: 0.06 },
  { provider: "openai",      model: "o3-mini",                      inputPer1kUsd: 0.0011, outputPer1kUsd: 0.0044 },

  // Google Gemini
  { provider: "google",      model: "gemini-2.5-flash",             inputPer1kUsd: 0.0005, outputPer1kUsd: 0.0015 },
  { provider: "google",      model: "gemini-2.5-pro",               inputPer1kUsd: 0.0025, outputPer1kUsd: 0.01 },
  { provider: "google",      model: "gemini-2.5-flash-lite",        inputPer1kUsd: 0.0003, outputPer1kUsd: 0.0006 },
  { provider: "google",      model: "gemini-2.0-flash",             inputPer1kUsd: 0.0001, outputPer1kUsd: 0.0004 },

  // Google Vertex
  { provider: "google_vertex_proxy", model: "gemini-2.5-flash",     inputPer1kUsd: 0.0005, outputPer1kUsd: 0.0015 },
  { provider: "google_vertex_proxy", model: "gemini-2.5-pro",       inputPer1kUsd: 0.0025, outputPer1kUsd: 0.01 },
  { provider: "google_vertex_proxy", model: "gemini-2.5-flash-lite", inputPer1kUsd: 0.0003, outputPer1kUsd: 0.0006 },

  // NVIDIA
  { provider: "nvidia",      model: "moonshotai/kimi-k2.6",         inputPer1kUsd: 0.002,  outputPer1kUsd: 0.008 },
  { provider: "nvidia",      model: "meta/llama-3.1-405b-instruct", inputPer1kUsd: 0.001,  outputPer1kUsd: 0.001 },

  // DeepSeek
  { provider: "deepseek",    model: "deepseek-chat",               inputPer1kUsd: 0.00027, outputPer1kUsd: 0.0011 },
  { provider: "deepseek",    model: "deepseek-reasoner",           inputPer1kUsd: 0.00055, outputPer1kUsd: 0.00219 },

  // GLM (Zhipu)
  { provider: "glm",         model: "glm-4-plus",                   inputPer1kUsd: 0.001,  outputPer1kUsd: 0.001 },
  { provider: "glm",         model: "glm-4-air",                    inputPer1kUsd: 0.0005, outputPer1kUsd: 0.0005 },
  { provider: "glm",         model: "glm-4-flash",                  inputPer1kUsd: 0.0001, outputPer1kUsd: 0.0001 },
  { provider: "glm",         model: "glm-4",                        inputPer1kUsd: 0.014,  outputPer1kUsd: 0.014 },
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
