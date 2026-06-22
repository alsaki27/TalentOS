// src/lib/ai/glmProvider.ts
// Zhipu AI's GLM models, via their OpenAI-compatible endpoint
// (open.bigmodel.cn). Uses the shared OpenAI-wire-format conversion in
// openAiCompatibleProvider.ts.

import { AiProvider } from "@/lib/ai/provider";
import { createOpenAiCompatibleProvider } from "@/lib/ai/openAiCompatibleProvider";

const GLM_API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
// Same caveat as openaiProvider.ts's DEFAULT_MODEL: not a recommendation, just a
// stable fallback when neither a per-key model override nor GLM_MODEL is set.
// Pick a current model via the admin AI Key Manager UI or GLM_MODEL instead.
const DEFAULT_MODEL = "glm-4-plus";

export function getGlmProvider(model?: string): AiProvider | null {
  const apiKey = process.env.GLM_API_KEY;
  if (!apiKey) return null;

  return createOpenAiCompatibleProvider({
    apiUrl: GLM_API_URL,
    apiKey,
    model: model || process.env.GLM_MODEL || DEFAULT_MODEL,
    errorLabel: "GLM API",
  });
}
