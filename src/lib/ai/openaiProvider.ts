// src/lib/ai/openaiProvider.ts
// OpenAI's Chat Completions API. Uses the shared OpenAI-wire-format conversion in
// openAiCompatibleProvider.ts (OpenAI's own format is what that file is modeled on
// in the first place).

import { AiProvider } from "@/lib/ai/provider";
import { createOpenAiCompatibleProvider } from "@/lib/ai/openAiCompatibleProvider";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
// Model selection is intentionally not hardcoded to one "best" choice here - model
// availability changes faster than this code does. Per-key model overrides (set
// via the admin AI Key Manager UI, stored in ai_api_keys.model) take priority;
// this is only the fallback when neither a key-specific model nor OPENAI_MODEL is
// set. gpt-4o is a stable, broadly-available baseline, not a recommendation to
// use it over a newer model - pick a current one in the admin UI or via
// OPENAI_MODEL instead of relying on this default.
const DEFAULT_MODEL = "gpt-4o";

export function getOpenAiProvider(model?: string, apiKey?: string, apiUrl = OPENAI_API_URL): AiProvider | null {
  if (!apiKey) return null;

  return createOpenAiCompatibleProvider({
    apiUrl,
    apiKey,
    model: model || DEFAULT_MODEL,
    errorLabel: "OpenAI API",
  });
}
