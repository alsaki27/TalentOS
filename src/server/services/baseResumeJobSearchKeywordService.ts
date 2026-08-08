import { query, queryOne } from "@/server/db/neon";
import { findAgentConfigByAutomationId } from "@/server/repositories/aiAgentConfigRepository";
import { callWithUsageTracking } from "@/lib/ai/routing";
import { textOf } from "@/lib/ai/provider";

export const BASE_RESUME_KEYWORD_AGENT_ID = "BaseResume_TO_JobSearchKeyword";
export const MAX_BASE_RESUME_KEYWORDS = 48;

const BASE_RESUME_KEYWORD_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    keywords: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          term: { type: "STRING" },
          category: { type: "STRING" },
          evidence: { type: "STRING" },
          reason: { type: "STRING" },
        },
        required: ["term", "category", "evidence", "reason"],
      },
    },
    additional_rules: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["keywords", "additional_rules"],
};

type KeywordState = {
  term: string;
  status: "active" | "dismissed";
  category?: string;
  evidence?: string;
  reason?: string;
  source?: "ai" | "manual";
  updated_by?: string | null;
  updated_at?: string;
};

type AgentKeyword = {
  term?: unknown;
  category?: unknown;
  evidence?: unknown;
  reason?: unknown;
};

type AgentOutput = {
  keywords?: Array<AgentKeyword | string>;
  additional_rules?: string[] | string;
};

const FALLBACK_SYSTEM_PROMPT = `You are BaseResume_TO_JobSearchKeyword. Build a focused job-search contract from one candidate base resume. Use only evidence in the resume, education, target industry, target roles, and explicit constraints. Never invent certifications, software, licenses, responsibilities, achievements, or years of experience. Reasonable title synonyms and defensible adjacent entry-level titles are allowed only when supported; mark them transferable or adjacent and bound them with rules. Return JSON only: {"keywords":[{"term":"...","category":"title|skill|tool|domain|work_product","evidence":"direct|transferable|adjacent","reason":"short reason"}],"additional_rules":["short rule"]}. Return 20–48 unique high-signal terms, never more than 48; fewer is better than padding. Use recruiter-used titles, core tools, domains, and work products. Remove generic filler, duplicate aliases, employer names, dates, and contact details. Return 4–8 precise ingestion rules covering experience, licenses, location, fit boundaries, and false-positive exclusions.`;

function cleanText(value: unknown, max = 240): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function normalizeTerm(value: unknown): string {
  return cleanText(value, 120).replace(/[\u0000-\u001f]/g, "");
}

function keyFor(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function repairCommonJsonSyntax(raw: string): string {
  let repaired = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (inString) {
      if (escaped) {
        repaired += character;
        escaped = false;
      } else if (character === "\\") {
        repaired += character;
        escaped = true;
      } else if (character === '"') {
        repaired += character;
        inString = false;
      } else if (character === "\n" || character === "\r") {
        repaired += "\\n";
      } else {
        repaired += character;
      }
      continue;
    }

    if (character === '"') inString = true;
    repaired += character;
    if (character === "}" || character === "]") {
      let next = index + 1;
      while (/\s/.test(raw[next] ?? "")) next += 1;
      if (raw[next] === "{" || raw[next] === "[") repaired += ",";
    }
  }

  // Models occasionally leave a trailing comma before a closing brace.
  return repaired.replace(/,\s*([}\]])/g, "$1");
}

function parseJsonResponse(raw: string): AgentOutput {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("Base resume keyword agent returned no JSON object");
  const candidate = cleaned.slice(first, last + 1);
  let parseError: any;
  for (const text of [candidate, repairCommonJsonSyntax(candidate)]) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== "object") throw new Error("response is not an object");
      return parsed as AgentOutput;
    } catch (error: any) {
      parseError = error;
    }
  }
  throw new Error(`Base resume keyword agent returned invalid JSON: ${parseError?.message || "unknown syntax error"}`);
}

function parseLineResponse(raw: string): AgentOutput {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const keywordIndex = lines.findIndex((line) => /^keywords\s*:?$/i.test(line));
  const rulesIndex = lines.findIndex((line) => /^rules?\s*:?$/i.test(line));
  if (keywordIndex < 0 || rulesIndex <= keywordIndex) {
    throw new Error("Base resume keyword agent returned neither valid JSON nor the fallback line format");
  }

  const stripBullet = (line: string) => line.replace(/^(?:[-*•]|\d+[.)])\s*/, "").trim();
  const keywords = lines
    .slice(keywordIndex + 1, rulesIndex)
    .map(stripBullet)
    .filter((term) => term.length > 1)
    .slice(0, MAX_BASE_RESUME_KEYWORDS)
    .map((term) => ({ term, category: "skill", evidence: "direct", reason: "AI-generated search term" }));
  const additional_rules = lines.slice(rulesIndex + 1).map(stripBullet).filter(Boolean).slice(0, 8);
  if (keywords.length < 10) throw new Error("Base resume keyword agent fallback returned too few keywords");
  return { keywords, additional_rules };
}

function parseUsableAgentResponse(raw: string): AgentOutput {
  const parsed = parseJsonResponse(raw);
  if (!Array.isArray(parsed.keywords) || parsed.keywords.length < 10) {
    throw new Error("Base resume keyword agent returned too few keywords");
  }
  return parsed;
}

function safeProfessionalSnapshot(content: any): any {
  if (!content || typeof content !== "object") return {};
  const snapshot = JSON.parse(JSON.stringify(content));
  if (snapshot.header) {
    delete snapshot.header.phone;
    delete snapshot.header.email;
    delete snapshot.header.linkedin;
  }
  // Keep a malformed or unexpectedly large resume from making the proxy call
  // appear to hang. The full resume remains in base_resumes; the AI only needs
  // a bounded professional snapshot for keyword discovery.
  const serialized = JSON.stringify(snapshot);
  if (serialized.length <= 24000) return snapshot;
  return {
    truncated: true,
    content_excerpt: serialized.slice(0, 24000),
  };
}

function normalizeRules(value: AgentOutput["additional_rules"]): string[] {
  const rules = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\n•]/) : [];
  return Array.from(new Set(rules.map((rule) => cleanText(rule, 500)).filter(Boolean))).slice(0, 8);
}

function normalizeAgentKeywords(value: AgentOutput["keywords"]): KeywordState[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const output: KeywordState[] = [];
  for (const item of value) {
    const record = typeof item === "string" ? { term: item } : item ?? {};
    const term = normalizeTerm(record.term);
    const key = keyFor(term);
    if (!term || term.length < 2 || seen.has(key)) continue;
    seen.add(key);
    output.push({
      term,
      status: "active",
      category: cleanText(record.category, 40) || "skill",
      evidence: cleanText(record.evidence, 24) || "direct",
      reason: cleanText(record.reason, 240),
      source: "ai",
    });
    if (output.length >= MAX_BASE_RESUME_KEYWORDS) break;
  }
  return output;
}

function asKeywordStates(value: unknown): KeywordState[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is KeywordState => Boolean(item && typeof item === "object" && typeof (item as any).term === "string"))
    .map((item): KeywordState => ({
      term: normalizeTerm(item.term),
      status: item.status === "dismissed" ? "dismissed" : "active",
      category: cleanText(item.category, 40),
      evidence: cleanText(item.evidence, 24),
      reason: cleanText(item.reason, 240),
      source: item.source === "manual" ? "manual" : "ai",
      updated_by: item.updated_by ?? null,
      updated_at: item.updated_at,
    }))
    .filter((item) => item.term.length > 1);
}

function mergeWithHumanReview(aiStates: KeywordState[], existingStates: KeywordState[]): KeywordState[] {
  const dismissed = new Set(existingStates.filter((item) => item.status === "dismissed").map((item) => keyFor(item.term)));
  const manualActive = existingStates.filter((item) => item.status === "active" && item.source === "manual");
  const result: KeywordState[] = [];
  const seen = new Set<string>();

  for (const item of manualActive) {
    const key = keyFor(item.term);
    if (key && !dismissed.has(key) && !seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  for (const item of aiStates) {
    const key = keyFor(item.term);
    if (key && !dismissed.has(key) && !seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
    if (result.length >= MAX_BASE_RESUME_KEYWORDS) break;
  }

  // Keep dismissed terms in the audit state so an AI rerun cannot silently
  // resurrect a manager's rejection.
  for (const item of existingStates.filter((entry) => entry.status === "dismissed")) {
    if (!result.some((entry) => keyFor(entry.term) === keyFor(item.term))) result.push(item);
  }
  return result;
}

export async function generateBaseResumeJobSearchProfile(options: {
  baseResumeId: string;
  triggerType?: "new_base_resume" | "resume_updated" | "manual" | "batch";
  userId?: string | null;
}) {
  const baseResume = await queryOne<any>(
    `SELECT br.id, br.candidate_id, br.name, br.target_industry, br.target_roles, br.content,
            c.name AS candidate_name, c.status AS candidate_status
       FROM base_resumes br
       JOIN candidates c ON c.id = br.candidate_id
      WHERE br.id = $1`,
    [options.baseResumeId]
  );
  if (!baseResume) throw new Error("Base resume not found");
  if (String(baseResume.candidate_status).toLowerCase() !== "active") {
    throw new Error("Keyword generation is limited to active candidates");
  }

  const existing = await queryOne<any>(
    "SELECT keyword_states, keywords FROM candidate_resume_search_profiles WHERE base_resume_id = $1",
    [options.baseResumeId]
  );

  // A browser tab can be closed or a Worker request can be terminated after
  // the audit row is inserted. Reap only genuinely stale runs, then prevent
  // duplicate clicks/tabs from launching multiple expensive model calls.
  await query(
    `UPDATE base_resume_keyword_agent_runs
        SET status = 'failed',
            error_message = 'Generation interrupted before completion',
            completed_at = NOW()
      WHERE base_resume_id = $1
        AND status = 'started'
        AND created_at < NOW() - INTERVAL '10 minutes'`,
    [options.baseResumeId]
  );
  const activeRun = await queryOne<{ id: string }>(
    `SELECT id
       FROM base_resume_keyword_agent_runs
      WHERE base_resume_id = $1
        AND status = 'started'
        AND created_at >= NOW() - INTERVAL '10 minutes'
      ORDER BY created_at DESC
      LIMIT 1`,
    [options.baseResumeId]
  );
  if (activeRun) throw new Error("Keyword generation is already running for this base resume. Wait for it to finish before trying again.");

  const existingStates = asKeywordStates(existing?.keyword_states);
  if (!existingStates.length && Array.isArray(existing?.keywords)) {
    existingStates.push(...existing.keywords.map((term: string) => ({ term, status: "active" as const, source: "manual" as const })));
  }

  const config = await findAgentConfigByAutomationId(BASE_RESUME_KEYWORD_AGENT_ID);
  const systemPrompt = config?.system_prompt || FALLBACK_SYSTEM_PROMPT;
  const promptVersion = config?.prompt_version || "v1.0";
  const professionalSnapshot = safeProfessionalSnapshot(baseResume.content);
  const inputSnapshot = {
    candidate_name: baseResume.candidate_name,
    target_industry: baseResume.target_industry,
    target_roles: baseResume.target_roles,
    base_resume_name: baseResume.name,
    content: professionalSnapshot,
  };
  const run = await queryOne<{ id: string }>(
    `INSERT INTO base_resume_keyword_agent_runs
      (candidate_id, base_resume_id, trigger_type, status, prompt_version, input_snapshot, created_by)
     VALUES ($1, $2, $3, 'started', $4, $5::jsonb, $6)
     RETURNING id`,
    [baseResume.candidate_id, baseResume.id, options.triggerType ?? "manual", promptVersion, JSON.stringify(inputSnapshot), options.userId ?? null]
  );
  await query(
    `INSERT INTO candidate_resume_search_profiles
      (candidate_id, base_resume_id, keywords, keyword_states, additional_rules, generation_status, last_generation_error, updated_by)
     VALUES ($1, $2, '{}', '[]'::jsonb, '', 'running', NULL, $3)
     ON CONFLICT (base_resume_id) DO UPDATE SET
       generation_status = 'running',
       last_generation_error = NULL,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()`,
    [baseResume.candidate_id, baseResume.id, options.userId ?? null]
  );

  try {
    const request = {
      system: systemPrompt,
      messages: [{
        role: "user" as const,
        content: [{
          type: "text" as const,
          text: `Create the job-search contract for this base resume. Keep the final keyword list between 30 and ${MAX_BASE_RESUME_KEYWORDS} terms. Return one valid JSON object only.\n\n${JSON.stringify(inputSnapshot)}`,
        }],
      }],
      tools: [],
      temperature: Number(config?.temperature ?? 0.2),
      maxTokens: Number(config?.max_output_tokens ?? 5000),
      timeoutMs: Number(config?.timeout_ms ?? 45000),
      responseSchema: BASE_RESUME_KEYWORD_RESPONSE_SCHEMA,
    };
    const call = await callWithUsageTracking(
      BASE_RESUME_KEYWORD_AGENT_ID,
      { userId: options.userId ?? undefined },
      async (provider) => {
        const firstResponse = await provider.send(request);
        try {
          return { response: firstResponse, parsed: parseUsableAgentResponse(textOf(firstResponse.content)) };
        } catch (firstError: any) {
          // Keep the primary Pro route, but give it one strict JSON-only retry.
          // This handles occasional missing commas/truncated string output
          // without persisting untrusted or partial keyword data.
          const retryResponse = await provider.send({
            ...request,
            system: `${systemPrompt}\n\nYour previous response was not valid JSON. Retry once. Output only a complete JSON object, with no markdown, comments, or unescaped line breaks inside strings. Keep reasons short and keep the keyword list focused.`,
            temperature: 0,
          });
          try {
            return { response: retryResponse, parsed: parseUsableAgentResponse(textOf(retryResponse.content)) };
          } catch {
            const lineResponse = await provider.send({
              ...request,
              responseSchema: undefined,
              responseMimeType: null,
              maxTokens: 1800,
              system: `${systemPrompt}\n\nReturn a plain-text fallback because JSON failed. Use exactly this format:\nKEYWORDS:\nThen one concise keyword or job title per line (20 to 48 lines).\nRULES:\nThen 4 to 8 concise ingestion rules, one per line. Do not use JSON, markdown tables, explanations, or paragraphs outside those sections.`,
              temperature: 0,
            });
            try {
              return { response: lineResponse, parsed: parseLineResponse(textOf(lineResponse.content)) };
            } catch {
              throw firstError;
            }
          }
        }
      }
    );
    const parsed = call.result.parsed;
    const aiStates = normalizeAgentKeywords(parsed.keywords);
    if (aiStates.length < 10) throw new Error("Base resume keyword agent returned too few usable keywords");
    const mergedStates = mergeWithHumanReview(aiStates, existingStates);
    const activeKeywords = mergedStates.filter((item) => item.status === "active").slice(0, MAX_BASE_RESUME_KEYWORDS).map((item) => item.term);
    const rules = normalizeRules(parsed.additional_rules);
    const completedAt = new Date().toISOString();
    const profile = await queryOne<any>(
      `INSERT INTO candidate_resume_search_profiles
        (candidate_id, base_resume_id, keywords, keyword_states, additional_rules, generation_status,
         last_generated_at, last_generation_model, last_generation_prompt_version, last_generation_error, updated_by)
       VALUES ($1, $2, $3, $4::jsonb, $5, 'complete', $6, $7, $8, NULL, $9)
       ON CONFLICT (base_resume_id) DO UPDATE SET
         keywords = EXCLUDED.keywords,
         keyword_states = EXCLUDED.keyword_states,
         additional_rules = EXCLUDED.additional_rules,
         generation_status = 'complete',
         last_generated_at = EXCLUDED.last_generated_at,
         last_generation_model = EXCLUDED.last_generation_model,
         last_generation_prompt_version = EXCLUDED.last_generation_prompt_version,
         last_generation_error = NULL,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
       RETURNING *`,
      [baseResume.candidate_id, baseResume.id, activeKeywords, JSON.stringify(mergedStates), rules.join("\n"), completedAt, call.model || "gemini-2.5-pro", promptVersion, options.userId ?? null]
    );
    await query(
      `UPDATE base_resume_keyword_agent_runs
          SET status = 'completed', model = $1, provider = $2, output_snapshot = $3::jsonb, completed_at = NOW()
        WHERE id = $4`,
      [call.model || "gemini-2.5-pro", call.providerName, JSON.stringify({ keywords: mergedStates, additional_rules: rules }), run?.id]
    );
    return { profile, keywords: activeKeywords, rules, model: call.model || "gemini-2.5-pro", promptVersion };
  } catch (error: any) {
    const message = cleanText(error?.message || "Unknown keyword agent error", 1000);
    await query(
      `UPDATE base_resume_keyword_agent_runs
          SET status = 'failed', error_message = $1, completed_at = NOW()
        WHERE id = $2`,
      [message, run?.id]
    );
    await query(
      `INSERT INTO candidate_resume_search_profiles
        (candidate_id, base_resume_id, keywords, keyword_states, additional_rules, generation_status, last_generation_error, updated_by)
       VALUES ($1, $2, '{}', '[]'::jsonb, '', 'failed', $3, $4)
       ON CONFLICT (base_resume_id) DO UPDATE SET
         generation_status = 'failed', last_generation_error = EXCLUDED.last_generation_error,
         updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [baseResume.candidate_id, baseResume.id, message, options.userId ?? null]
    );
    throw error;
  }
}

export async function generateAllActiveBaseResumeJobSearchProfiles(options: { userId?: string | null } = {}) {
  const resumes = await query<{ id: string }>(
    `SELECT br.id
       FROM base_resumes br
       JOIN candidates c ON c.id = br.candidate_id
      WHERE lower(c.status) = 'active'
      ORDER BY c.name, br.name`
  );
  const results: Array<Record<string, unknown>> = [];
  for (const resume of resumes) {
    try {
      const result = await generateBaseResumeJobSearchProfile({
        baseResumeId: resume.id,
        triggerType: "batch",
        userId: options.userId,
      });
      results.push({ baseResumeId: resume.id, status: "completed", keywordCount: result.keywords.length, model: result.model });
    } catch (error: any) {
      results.push({ baseResumeId: resume.id, status: "failed", error: cleanText(error?.message || "Unknown error", 500) });
    }
  }
  return results;
}
