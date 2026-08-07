import type { AiMessage, AiProvider, AiResponse } from "@/lib/ai/provider";
import type { AgentContext, AgentOptions } from "./types";
import { CopilotFillPlanSchema, type CopilotFillPlanV1 } from "./schemas";
import { buildCopilotFillerPrompt, type CopilotFillerInputContext } from "./prompts/copilotFiller";
import { textOf } from "@/lib/ai/provider";

type CopilotFillerRequest = Parameters<AiProvider["send"]>[0];

export async function runCopilotFiller(
  options: AgentOptions,
  provider: AiProvider,
  ctx: AgentContext & {
    formFields: any[];
    priorCorrections?: CopilotFillerInputContext["priorCorrections"];
    formAnalystNotes?: string;
  } // Extended context for this specific agent
): Promise<CopilotFillPlanV1> {
  const fallbackPlan = (): CopilotFillPlanV1 => {
    const profile: any = (ctx as any).candidateProfile || {};
    const valueFor = (field: any): string | null => {
      const label = `${field.label || ""} ${field.name || ""} ${field.placeholder || ""}`.toLowerCase();
      if (/first.?name|given.?name/.test(label)) return String(profile.name || "").split(/\s+/)[0] || null;
      if (/last.?name|surname|family.?name/.test(label)) return String(profile.name || "").split(/\s+/).slice(1).join(" ") || null;
      if (/^email$|email.?address|e-mail/.test(label)) return profile.email || null;
      if (/phone|mobile|telephone|contact.?number/.test(label)) return profile.phone || null;
      if (/linkedin/.test(label)) return profile.linkedin || null;
      if (/portfolio|personal.?website|website|url/.test(label)) return profile.portfolio || null;
      if (/city|location|address/.test(label)) return profile.location || null;
      return null;
    };
    return { instructions: ctx.formFields.map((field: any) => {
      const value = valueFor(field);
      return { selector: field.selector, fieldType: value ? "text" : "skip", value: value || "", confidence: value ? "high" : "low", reasoning: value ? "Matched candidate profile" : "Needs manual review" } as any;
    }) };
  };
  const compact = (value: string, max: number) => value.length > max ? `${value.slice(0, max)}\n[truncated for reliability]` : value;
  const compactFields = ctx.formFields.slice(0, 160).map((field: any) => ({
    ...field,
    label: compact(String(field.label || ""), 180),
    placeholder: compact(String(field.placeholder || ""), 120),
    ariaLabel: compact(String(field.ariaLabel || ""), 120),
    options: Array.isArray(field.options) ? field.options.slice(0, 40).map((option: string) => compact(String(option), 120)) : field.options,
  }));
  const inputContext: CopilotFillerInputContext = {
    formFields: compactFields,
    priorCorrections: ctx.priorCorrections,
    formAnalystNotes: ctx.formAnalystNotes,
    candidateProfile: {
      name: (ctx as any).candidateProfile?.name || "Unknown Candidate",
      email: (ctx as any).candidateProfile?.email || "",
      phone: (ctx as any).candidateProfile?.phone || "",
      location: (ctx as any).candidateProfile?.location || "",
      linkedin: (ctx as any).candidateProfile?.linkedin || "",
      portfolio: (ctx as any).candidateProfile?.portfolio || "",
      workAuthorization: (ctx as any).candidateProfile?.workAuthorization || "",
      salaryExpectation: (ctx as any).candidateProfile?.salaryExpectation || "",
      noticePeriod: (ctx as any).candidateProfile?.noticePeriod || "",
      verifiedSkills: ctx.verifiedSkills,
      targetRoles: (ctx as any).candidateProfile?.targetRoles || [],
    },
    resumeText: compact(typeof ctx.baseResume.content === "string" ? ctx.baseResume.content : JSON.stringify(ctx.baseResume.content), 14000),
    jobTitle: ctx.job.title,
    company: ctx.job.company || "Unknown Company",
    jdText: compact(ctx.job.description || ctx.job.rawDescription || "", 12000),
  };

  const request: CopilotFillerRequest = {
    system: options.system_prompt ?? "You are Copilot Fill Planner. Return only valid JSON.",
    messages: [
      { role: "user", content: [{ type: "text", text: buildCopilotFillerPrompt(inputContext) }] },
    ] as AiMessage[],
    tools: [],
    temperature: options.temperature,
    maxTokens: options.max_output_tokens,
    timeoutMs: options.timeout_ms,
  };

  let response: AiResponse;
  try {
    response = await provider.send(request);
  } catch (firstError) {
    // A provider timeout/abort is recoverable for this non-destructive planner.
    // Retry with a smaller completion budget before surfacing an error.
    try {
      response = await provider.send({ ...request, temperature: 0, maxTokens: 4096, timeoutMs: Math.min(options.timeout_ms ?? 20000, 20000) });
    } catch {
      return fallbackPlan();
    }
  }

  const parseResponse = (content: typeof response.content) => {
    const raw = textOf(content);
    const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripped);
    } catch {
      return null;
    }
    const validated = CopilotFillPlanSchema.parse(parsed);
    return "error" in validated ? null : validated;
  };

  let validated = parseResponse(response.content);
  if (!validated) {
    // Providers occasionally truncate a long plan or emit an unescaped quote in
    // reasoning. Retry once with a compact instruction that materially reduces
    // the response surface; never attempt to invent a repair of candidate data.
    try {
      response = await provider.send({
        ...request,
        temperature: 0,
        maxTokens: Math.max(options.max_output_tokens ?? 0, 12000),
        messages: [
          ...request.messages,
          { role: "user", content: [{ type: "text", text: "Retry: output compact valid JSON only. Use reasoning of 80 characters or fewer. No markdown, no extra text, and include one instruction per field." }] },
        ] as AiMessage[],
      });
      validated = parseResponse(response.content);
    } catch {
      return fallbackPlan();
    }
  }
  if (!validated) {
    // Keep Analyze usable and force manual review rather than failing the whole
    // request when the model cannot produce a valid plan.
    return fallbackPlan();
  }
  return validated;
}
