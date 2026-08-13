// src/lib/ai/emailTriage.ts
// Classifies one ingested Gmail message: is it recruiting-relevant, what does it
// signal about an application's status, does it need a reply. Same single-shot
// pattern as src/lib/ai/jobCategorization.ts, routed via the "email_triage"
// automation_id (gemini-2.5-flash-lite by default — cheap, high-volume, see
// sql/neon_fixes/046_email_triage_and_gmail_sync.sql).

import { callWithUsageTracking } from "@/lib/ai/routing";
import { textOf } from "@/lib/ai/provider";

export interface TriageCandidateContext {
  applicationId: string;
  jobTitle: string;
  company: string;
  status: string;
}

export interface TriageInput {
  subject: string | null;
  bodyText: string;
  fromEmail: string | null;
  applications: TriageCandidateContext[];
}

export type EmailCategory =
  | "interview_invite"
  | "rejection"
  | "offer"
  | "recruiter_reply"
  | "application_invite"
  | "application_confirmation"
  | "scheduling"
  | "other";

const VALID_CATEGORIES = new Set<EmailCategory>([
  "interview_invite", "rejection", "offer", "recruiter_reply", "application_invite", "application_confirmation", "scheduling", "other",
]);

export interface TriageResult {
  relevant: boolean;
  category: EmailCategory;
  confidence: number;
  matchedApplicationId: string | null;
  suggestedStatus: string | null;
  needsReply: boolean;
  summary: string;
}

// Auto-write applications.status only for high-confidence, unambiguous
// categories. Everything else always goes to a human via action_items —
// see §4.3 of the handover doc for the reasoning. These are the risk_based
// policy's fallback defaults (see emailApprovalPolicy.ts) - used verbatim
// when the ai_agent_configs row for email_triage is missing or its
// minimum_score is unset, so removing that row can never loosen behavior.
export const AUTO_WRITE_CATEGORIES: ReadonlySet<EmailCategory> = new Set(["interview_invite", "rejection", "offer"]);
export const AUTO_WRITE_CONFIDENCE_THRESHOLD = 0.85;

// application_confirmation keeps its own, separate, higher confidence bar -
// a qualitatively different judgment (did the candidate definitely apply)
// from the interview/offer/rejection signal AUTO_WRITE_CONFIDENCE_THRESHOLD
// (and its admin-tunable replacement, minimum_score) governs. Not affected
// by the risk_based policy's configurable threshold.
export const APPLICATION_CONFIRMATION_CONFIDENCE = 0.9;

// Minimum extractInterviewDetails confidence required to actually write an
// interview_schedules row (vs. just leaving an AE to review the raw email).
export const INTERVIEW_EXTRACTION_CONFIDENCE = 0.75;

function buildPrompt(input: TriageInput): string {
  const appList = input.applications.length
    ? input.applications.map((a) => `- application_id=${a.applicationId}: "${a.jobTitle}" at ${a.company} (current status: ${a.status})`).join("\n")
    : "(no open applications on file)";

  return [
    "You are triaging one email from a job candidate's inbox for a recruiting agency that manages their applications on their behalf.",
    "Decide if this email is relevant to an active recruiting workflow (interview scheduling, application status, offers/rejections, recruiter correspondence, or a direct invitation to apply).",
    "Mark relevant=false for job alerts, recommendation digests, newsletters, marketing, sponsored/promoted mail, bulk talent-network campaigns, and generic Indeed/LinkedIn messages such as 'you look like a great fit' unless the message is a specific human/recruiter exchange or a concrete interview/application request.",
    "Mark relevant=false for personal receipts, food delivery, rideshare, shopping, shipping, banking, medical, travel, social, and account-security mail, even if the candidate uses the same Gmail inbox for applications. A concrete application confirmation means the candidate submitted an application and is category application_confirmation.",
    "An interview invite or scheduling request is high priority. A direct invitation to apply is relevant and must create a pending human task; it is resolved only by a same-thread outbound reply or explicit AE resolution.",
    "",
    "Candidate's open applications:",
    appList,
    "",
    `From: ${input.fromEmail ?? "unknown"}`,
    `Subject: ${input.subject ?? "(no subject)"}`,
    "Body:",
    input.bodyText.slice(0, 4000),
    "",
    "Respond with ONLY this JSON object, no markdown fences, no other text:",
    '{"relevant": boolean, "category": "interview_invite"|"rejection"|"offer"|"recruiter_reply"|"application_invite"|"application_confirmation"|"scheduling"|"other", "confidence": number (0-1), "matched_application_id": string|null, "suggested_status": string|null, "needs_reply": boolean, "summary": string (one sentence)}',
  ].join("\n");
}

function parseResult(raw: string, applications: TriageCandidateContext[]): TriageResult {
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const parsed = JSON.parse(stripped);

  const category: EmailCategory = VALID_CATEGORIES.has(parsed.category) ? parsed.category : "other";
  const matchedId = typeof parsed.matched_application_id === "string" ? parsed.matched_application_id : null;
  const validMatch = matchedId && applications.some((a) => a.applicationId === matchedId) ? matchedId : null;

  return {
    relevant: Boolean(parsed.relevant),
    category,
    confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0,
    matchedApplicationId: validMatch,
    suggestedStatus: typeof parsed.suggested_status === "string" ? parsed.suggested_status : null,
    needsReply: Boolean(parsed.needs_reply),
    summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 500) : "",
  };
}

export async function triageEmail(input: TriageInput): Promise<TriageResult> {
  const { result } = await callWithUsageTracking("email_triage", undefined, async (provider) => {
    const response = await provider.send({
      system: "You are a strict, literal email classifier for a recruiting workflow. Respond with raw JSON only.",
      messages: [{ role: "user", content: [{ type: "text", text: buildPrompt(input) }] }],
      tools: [],
    });
    return parseResult(textOf(response.content), input.applications);
  });
  return result;
}
