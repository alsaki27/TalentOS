// src/lib/ai/index.ts
// Picks whichever AI provider is actually configured. Set AI_PROVIDER=anthropic or
// AI_PROVIDER=nvidia to force one; otherwise prefers Anthropic if its key is set,
// falling back to NVIDIA (Kimi K2 via integrate.api.nvidia.com) if not. Callers
// (chat route, digest cron) only see the AiProvider interface either way.

import { getAnthropicProvider } from "@/lib/ai/anthropicProvider";
import { getNvidiaProvider } from "@/lib/ai/nvidiaProvider";
import { AiProvider } from "@/lib/ai/provider";

export interface ActiveProvider {
  provider: AiProvider;
  name: "anthropic" | "nvidia";
}

export function getActiveProvider(): ActiveProvider | null {
  const preferred = process.env.AI_PROVIDER;

  if (preferred === "nvidia") {
    const provider = getNvidiaProvider();
    if (provider) return { provider, name: "nvidia" };
  }
  if (preferred === "anthropic") {
    const provider = getAnthropicProvider();
    if (provider) return { provider, name: "anthropic" };
  }

  const anthropic = getAnthropicProvider();
  if (anthropic) return { provider: anthropic, name: "anthropic" };

  const nvidia = getNvidiaProvider();
  if (nvidia) return { provider: nvidia, name: "nvidia" };

  return null;
}
