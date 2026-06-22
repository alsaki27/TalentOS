// src/lib/ai/nvidiaProvider.ts
// NVIDIA's hosted inference API (integrate.api.nvidia.com) speaks OpenAI-compatible
// chat completions - the shared conversion logic lives in openAiCompatibleProvider.ts
// (also used by openaiProvider.ts and glmProvider.ts, which speak the same wire
// format). This file just supplies NVIDIA's endpoint/model/auth and the
// degeneration workaround below.

import { AiProvider } from "@/lib/ai/provider";
import { createOpenAiCompatibleProvider } from "@/lib/ai/openAiCompatibleProvider";

const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const DEFAULT_MODEL = "moonshotai/kimi-k2.6";

export function getNvidiaProvider(): AiProvider | null {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) return null;

  return createOpenAiCompatibleProvider({
    apiUrl: NVIDIA_API_URL,
    apiKey,
    model: process.env.NVIDIA_MODEL || DEFAULT_MODEL,
    temperature: 0.4,
    errorLabel: "NVIDIA API",
    extraBody: {
      top_p: 1,
      // Without these, this model reliably degenerates into repeating itself verbatim
      // after receiving a tool result (confirmed live: finish_reason "repetition") —
      // not a hypothetical, this reproduced on the first round-trip tool-result test.
      frequency_penalty: 0.6,
      presence_penalty: 0.4,
    },
  });
}
