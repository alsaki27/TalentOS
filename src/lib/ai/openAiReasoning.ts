const STANDARD_EFFORTS = ["low", "medium", "high", "xhigh"] as const;
const EXTENDED_EFFORTS = [...STANDARD_EFFORTS, "max"] as const;
const STANDARD_WITH_OFF = ["off", ...STANDARD_EFFORTS] as const;
const EXTENDED_WITH_OFF = ["off", ...EXTENDED_EFFORTS] as const;

export const isOpenAiLuna = (model: string | null | undefined): model is string =>
  !!model && /^gpt-(?:6|5\.6)-luna(?:-|$)/.test(model);

export function openAiReasoningEfforts(model: string | null | undefined): readonly string[] {
  const id = model?.toLowerCase().replace(/-\d{4}-\d{2}-\d{2}$/, "");
  if (id === "gpt-6-astra" || id === "gpt-6.1-sol") return EXTENDED_EFFORTS;
  if (isOpenAiLuna(model) || id === "gpt-6-sol" || id === "gpt-6.1-terra" ||
      id === "gpt-5.6" || id === "gpt-5.6-sol" || id === "gpt-5.6-terra") return EXTENDED_WITH_OFF;
  if (id === "gpt-5.5" || id === "gpt-5.4") return STANDARD_WITH_OFF;
  return [];
}

export function configuredOpenAiReasoningEffort(model: string | null | undefined, effort?: string | null): string | undefined {
  return effort && openAiReasoningEfforts(model).includes(effort)
    ? effort === "off" ? "none" : effort
    : isOpenAiLuna(model) ? "none" : undefined;
}

// The Forge reply is a short list of evidence IDs. OpenAI counts hidden
// reasoning in the same output limit, so give it headroom only when enabled.
export function forgeReasoningOutputBudget(effort: string | null | undefined): number {
  switch (effort) {
    case "low": return 1024;
    case "medium": return 2048;
    case "high": return 4096;
    case "xhigh":
    case "max": return 8192;
    default: return 0;
  }
}
