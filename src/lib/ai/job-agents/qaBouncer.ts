import type { AiProvider } from "@/lib/ai/provider";
import type { JobCeoAgentContext, StagedJob } from "./types";
import { QaVerdictSchema, type QaVerdictV1 } from "./schemas";
import { buildQaBouncerPrompt } from "./prompts/qaBouncer";
import { textOf } from "@/lib/ai/provider";

export async function runQaBouncer(
  options: { system_prompt?: string; temperature?: number; max_output_tokens?: number; timeout_ms?: number },
  provider: AiProvider,
  ctx: JobCeoAgentContext
): Promise<QaVerdictV1> {
  var stagedJob: StagedJob | undefined;
  try {
    stagedJob = ctx.previousOutputs.stagedJob as StagedJob | undefined;
  } catch (_) {
    // fall through to regex
  }

  if (stagedJob) {
    try {
      var response = await provider.send({
        system: options.system_prompt ?? "You are QA Bouncer, a quality-control agent for TalentOS. Return only valid JSON.",
        messages: [
          { role: "user", content: [{ type: "text", text: buildQaBouncerPrompt(stagedJob) }] },
        ],
        tools: [],
        temperature: options.temperature,
        maxTokens: options.max_output_tokens,
        timeoutMs: options.timeout_ms,
      });

      var raw = textOf(response.content);
      var stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      var parsed = JSON.parse(stripped);
      var validated = QaVerdictSchema.parse(parsed);
      if ("error" in validated) {
        console.warn("[QA Bouncer] AI output invalid, falling back to regex: " + validated.error);
      } else {
        return validated;
      }
    } catch (err) {
      console.warn("[QA Bouncer] AI call failed, falling back to regex:", (err as Error).message ?? String(err));
    }
  }

  return classifyWithRegex(stagedJob);
}

function classifyWithRegex(stagedJob?: StagedJob): QaVerdictV1 {
  var title = (stagedJob?.title ?? "").toLowerCase();
  var text = (stagedJob?.description_text ?? stagedJob?.snippet ?? "").toLowerCase();
  var combined = title + " " + text;

  var falsePositivePatterns = [
    "software engineer", "software developer", "react developer", "data scientist",
    "machine learning engineer", "full stack", "frontend", "backend engineer",
    "devops", "sre", "site reliability", "mobile developer", "ios developer",
    "android developer", "web developer", "javascript", "python developer",
    "java developer", "node.js developer", "cloud architect", "platform engineer",
    "product manager", "ux designer", "ui designer", "graphic designer",
    "marketing", "sales", "accountant", "nurse", "doctor", "teacher",
    "restaurant", "retail", "warehouse", "delivery driver", "truck driver",
    "customer service", "call center", "data entry", "administrative assistant",
  ];

  for (var i = 0; i < falsePositivePatterns.length; i++) {
    if (title.indexOf(falsePositivePatterns[i]) !== -1 || combined.indexOf(falsePositivePatterns[i]) !== -1) {
      var score = title.indexOf(falsePositivePatterns[i]) !== -1 ? 0 : 20;
      return { keep: false, score: score, tier: "skip", reason: "False positive match: " + falsePositivePatterns[i] };
    }
  }

  var targetPatterns = [
    "osp", "outside plant", "fiber", "fibre", "telecom", "telecommunications",
    "utility", "gis", "geographic", "cad", "drafting", "drafter", "civil",
    "construction", "broadband", "network design", "cable", "splicing",
    "coax", "pole", "aerial", "underground", "conduit", "permitting",
    "row", "right of way", "ftth", "fttp", "fttx", "5g", "cell site",
    "infrastructure", "survey", "land", "site acquisition",
  ];

  var matchCount = 0;
  for (var j = 0; j < targetPatterns.length; j++) {
    if (combined.indexOf(targetPatterns[j]) !== -1) matchCount++;
  }

  if (matchCount >= 3) {
    return { keep: true, score: 85, tier: "best", reason: "Strong target-industry signals: " + matchCount + " keyword matches" };
  }
  if (matchCount >= 1) {
    if (!text || text.length < 50) {
      return { keep: true, score: 50, tier: "medium", reason: "Target industry signal but thin description" };
    }
    return { keep: true, score: 70, tier: "medium", reason: "Target industry signal: " + matchCount + " keyword matches" };
  }

  if (!text || text.length < 50) {
    return { keep: false, score: 0, tier: "skip", reason: "No target-industry signals and no description text" };
  }

  var engineeringAdjacent = ["engineer", "designer", "technician", "specialist", "analyst", "manager", "director", "coordinator", "inspector", "planner"];
  var hasAdjacent = false;
  for (var k = 0; k < engineeringAdjacent.length; k++) {
    if (title.indexOf(engineeringAdjacent[k]) !== -1) { hasAdjacent = true; break; }
  }

  if (hasAdjacent && text.length > 100) {
    return { keep: true, score: 40, tier: "worthy", reason: "Engineering-adjacent title, may be relevant; needs manual review" };
  }

  return { keep: false, score: 10, tier: "skip", reason: "No target-industry signals detected" };
}
