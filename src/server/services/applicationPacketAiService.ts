// src/server/services/applicationPacketAiService.ts
// AI-powered cover letter and recruiter message generation.
// NEVER invents experience, degree, certification, employer, project, or visa status.
// NEVER uses rejected keywords. NEVER claims missing-evidence keywords.

import { getProviderForCategory } from "@/lib/ai";
import { textOf } from "@/lib/ai/provider";
import { findApplicationById } from "@/server/repositories/applicationsRepository";
import { findCandidateById } from "@/server/repositories/candidatesRepository";
import { findJobById } from "@/server/repositories/jobsRepository";
import { listApplicationKeywords } from "@/server/repositories/applicationKeywordsRepository";
import { listSuggestionsByApplication } from "@/server/repositories/applicationResumeSuggestionsRepository";
import { getCurrentDraftForApplication } from "@/server/repositories/applicationResumeVersionsRepository";
import { buildResumeContext, ResumeContext } from "@/server/services/resumeContextService";
import { findTargetJobByCandidateAndJob } from "@/server/repositories/targetJobsRepository";
import type { ApplicationKeywordRow } from "@/server/repositories/applicationKeywordsRepository";
import type { ApplicationResumeSuggestionRow } from "@/server/repositories/applicationResumeSuggestionsRepository";

export interface GenerateAiDraftOptions {
  tone?: "professional" | "friendly" | "formal";
  maxLength?: number;
}

export interface CoverLetterResult {
  coverLetter: string;
  subject?: string;
  warnings?: string[];
}

export interface RecruiterMessageResult {
  message: string;
  subject?: string;
  warnings?: string[];
}

export async function generateCoverLetterDraft(
  applicationId: string,
  options: GenerateAiDraftOptions = {}
): Promise<CoverLetterResult> {
  const app = await findApplicationById(applicationId);
  if (!app) return errorCoverLetter("Application not found");

  const candidate = app.candidate_id ? await findCandidateById(app.candidate_id) : null;
  const job = app.job_id ? await findJobById(app.job_id) : null;
  const allKeywords = await listApplicationKeywords(applicationId);
  const approvedKeywords = allKeywords.filter((k) => k.status === "approved");
  const rejectedKeywords = allKeywords.filter((k) => k.status === "rejected");
  const suggestions = await listSuggestionsByApplication(applicationId);
  const acceptedSuggestions = suggestions.filter((s) => s.status === "accepted");

  const context = app.candidate_id ? await buildResumeContext(app.candidate_id) : null;

  let draftVersion = null;
  if (app.job_id && app.candidate_id) {
    const targetJob = await findTargetJobByCandidateAndJob(app.candidate_id, app.job_id);
    if (targetJob) {
      draftVersion = await getCurrentDraftForApplication(app.candidate_id, targetJob.id);
    }
  }

  const active = await getProviderForCategory("content_generation");
  if (!active) return errorCoverLetter("No AI provider configured");

  const warnings: string[] = [];

  for (const kw of approvedKeywords) {
    if (kw.evidence_status === "missing" || kw.evidence_status === "unmapped") {
      warnings.push(`Missing evidence for approved keyword: ${kw.keyword}`);
    }
  }

  for (const s of acceptedSuggestions) {
    if (s.truth_status === "fabrication_risk") {
      warnings.push(`High-risk suggestion accepted: ${s.proposed_text.slice(0, 60)}`);
    }
  }

  const prompt = buildCoverLetterPrompt({
    candidateName: candidate?.name ?? null,
    jobTitle: job?.title ?? null,
    companyName: job?.company ?? null,
    approvedKeywords,
    rejectedKeywords,
    context,
    acceptedSuggestions,
    draftVersion,
    options,
  });

  try {
    const response = await active.provider.send({
      system: buildCoverLetterSystemPrompt(),
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      tools: [],
    });

    const raw = textOf(response.content)
      .trim()
      .replace(/^```(?:markdown)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    const parsed = parseCoverLetterResponse(raw);
    return {
      coverLetter: parsed.coverLetter,
      subject: parsed.subject,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (err: any) {
    return errorCoverLetter(err.message ?? "Cover letter generation failed");
  }
}

export async function generateRecruiterMessageDraft(
  applicationId: string,
  options: GenerateAiDraftOptions = {}
): Promise<RecruiterMessageResult> {
  const app = await findApplicationById(applicationId);
  if (!app) return errorRecruiterMessage("Application not found");

  const candidate = app.candidate_id ? await findCandidateById(app.candidate_id) : null;
  const job = app.job_id ? await findJobById(app.job_id) : null;
  const allKeywords = await listApplicationKeywords(applicationId);
  const approvedKeywords = allKeywords.filter((k) => k.status === "approved");
  const rejectedKeywords = allKeywords.filter((k) => k.status === "rejected");
  const suggestions = await listSuggestionsByApplication(applicationId);
  const acceptedSuggestions = suggestions.filter((s) => s.status === "accepted");

  const context = app.candidate_id ? await buildResumeContext(app.candidate_id) : null;

  let draftVersion = null;
  if (app.job_id && app.candidate_id) {
    const targetJob = await findTargetJobByCandidateAndJob(app.candidate_id, app.job_id);
    if (targetJob) {
      draftVersion = await getCurrentDraftForApplication(app.candidate_id, targetJob.id);
    }
  }

  const active = await getProviderForCategory("content_generation");
  if (!active) return errorRecruiterMessage("No AI provider configured");

  const warnings: string[] = [];

  for (const kw of approvedKeywords) {
    if (kw.evidence_status === "missing" || kw.evidence_status === "unmapped") {
      warnings.push(`Missing evidence for approved keyword: ${kw.keyword}`);
    }
  }

  for (const s of acceptedSuggestions) {
    if (s.truth_status === "fabrication_risk") {
      warnings.push(`High-risk suggestion accepted: ${s.proposed_text.slice(0, 60)}`);
    }
  }

  const prompt = buildRecruiterMessagePrompt({
    candidateName: candidate?.name ?? null,
    jobTitle: job?.title ?? null,
    companyName: job?.company ?? null,
    approvedKeywords,
    rejectedKeywords,
    context,
    acceptedSuggestions,
    draftVersion,
    options,
  });

  try {
    const response = await active.provider.send({
      system: buildRecruiterMessageSystemPrompt(),
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      tools: [],
    });

    const raw = textOf(response.content)
      .trim()
      .replace(/^```(?:markdown)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    const parsed = parseRecruiterMessageResponse(raw);
    return {
      message: parsed.message,
      subject: parsed.subject,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (err: any) {
    return errorRecruiterMessage(err.message ?? "Recruiter message generation failed");
  }
}

export async function generatePacketSummary(applicationId: string): Promise<string> {
  const app = await findApplicationById(applicationId);
  if (!app) return "Application not found";

  const candidate = app.candidate_id ? await findCandidateById(app.candidate_id) : null;
  const job = app.job_id ? await findJobById(app.job_id) : null;
  const allKeywords = await listApplicationKeywords(applicationId);
  const approvedKeywords = allKeywords.filter((k) => k.status === "approved");
  const rejectedKeywords = allKeywords.filter((k) => k.status === "rejected");
  const suggestions = await listSuggestionsByApplication(applicationId);
  const acceptedSuggestions = suggestions.filter((s) => s.status === "accepted");

  const context = app.candidate_id ? await buildResumeContext(app.candidate_id) : null;

  const active = await getProviderForCategory("content_generation");
  if (!active) return "No AI provider configured";

  const prompt = buildSummaryPrompt({
    candidateName: candidate?.name ?? null,
    jobTitle: job?.title ?? null,
    companyName: job?.company ?? null,
    approvedKeywords,
    rejectedKeywords,
    context,
    acceptedSuggestions,
  });

  try {
    const response = await active.provider.send({
      system:
        "You are a concise packet reviewer. Summarize the readiness and key points of a job application packet in 2-4 sentences. Be factual, not promotional. Note strengths and gaps.",
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      tools: [],
    });

    return textOf(response.content).trim();
  } catch (err: any) {
    return `Summary generation failed: ${err.message ?? "Unknown error"}`;
  }
}

// ───────────────────────────────────────────────────────────────
// Prompt builders
// ───────────────────────────────────────────────────────────────

interface PromptData {
  candidateName: string | null;
  jobTitle: string | null;
  companyName: string | null;
  approvedKeywords: ApplicationKeywordRow[];
  rejectedKeywords: ApplicationKeywordRow[];
  context: ResumeContext | null;
  acceptedSuggestions: ApplicationResumeSuggestionRow[];
  draftVersion: { generated_text: string | null; content: Record<string, unknown> } | null;
  options?: GenerateAiDraftOptions;
}

function buildCoverLetterSystemPrompt(): string {
  return [
    "You are a precise cover letter writer. You write short, natural, professional cover letters.",
    "",
    "SAFETY RULES (never violate):",
    "1. Do NOT invent experience, degree, certification, employer, project, visa status, or years of experience.",
    "2. Do NOT use rejected keywords.",
    "3. Do NOT claim missing-evidence keywords.",
    "4. Keep it short, natural, and editable.",
    "5. No fake enthusiasm. No overconfident unsupported claims.",
    "6. Tone: professional, direct, human.",
    "7. 3-5 short paragraphs max.",
    "8. Every claim must be supported by the candidate's evidence.",
    "9. If evidence is missing for a keyword, do not mention it.",
    "",
    "Output the cover letter as plain text. Optionally include a subject line on the first line prefixed with 'Subject: '.",
  ].join("\n");
}

function buildCoverLetterPrompt(data: PromptData): string {
  const approvedWithEvidence = data.approvedKeywords
    .filter((k) => k.evidence_status !== "missing" && k.evidence_status !== "unmapped")
    .map(
      (k) =>
        `  - ${k.keyword} (${k.category})${k.evidence_summary ? ` — evidence: ${k.evidence_summary}` : ""}`
    )
    .join("\n");

  const rejectedText = data.rejectedKeywords
    .map((k) => `  - ${k.keyword} (${k.category})`)
    .join("\n");

  const experienceText = data.context?.baseResume
    ? data.context.baseResume.experience.map((e) => `${e.title} at ${e.company}`).join("; ")
    : data.context?.uploadedResume
      ? data.context.uploadedResume.parsedExperience.map((e) => `${e.title} at ${e.company}`).join("; ")
      : "No resume experience available";

  const skillsText = data.context?.baseResume
    ? data.context.baseResume.skills.map((sg) => `${sg.title}: ${sg.skills.join(", ")}`).join("; ")
    : data.context?.uploadedResume
      ? data.context.uploadedResume.parsedSkills.join(", ")
      : "No skills available";

  const draftSummary = data.draftVersion
    ? `Draft resume version exists (generated text: ${data.draftVersion.generated_text ? "present" : "not present"})`
    : "No draft resume version yet";

  return [
    "=== JOB ===",
    `Title: ${data.jobTitle ?? "Unknown"}`,
    `Company: ${data.companyName ?? "Unknown"}`,
    "",
    "=== CANDIDATE ===",
    `Name: ${data.candidateName ?? "Unknown"}`,
    `Experience: ${experienceText}`,
    `Skills: ${skillsText}`,
    data.context?.targetRoles ? `Target roles: ${data.context.targetRoles}` : "",
    data.context?.workAuthorization ? `Work authorization: ${data.context.workAuthorization}` : "",
    "",
    "=== APPROVED KEYWORDS WITH EVIDENCE (use these) ===",
    approvedWithEvidence || "(none)",
    "",
    "=== REJECTED KEYWORDS (NEVER mention these) ===",
    rejectedText || "(none)",
    "",
    "=== ACCEPTED SUGGESTIONS (reflect these changes in the letter) ===",
    data.acceptedSuggestions
      .filter((s) => s.suggestion_type !== "truth_warning" && s.suggestion_type !== "missing_evidence")
      .map((s) => `  - ${s.target_section}: ${s.proposed_text.slice(0, 120)}`)
      .join("\n") || "(none)",
    "",
    "=== RESUME DRAFT STATUS ===",
    draftSummary,
    "",
    "=== INSTRUCTIONS ===",
    "Write a 3-5 paragraph cover letter. Mention 2-4 of the approved keywords that have evidence. Do NOT mention rejected keywords. Do NOT invent unsupported claims. Keep it natural and professional.",
    "",
    "Return the cover letter text directly. If you want to include a subject line, put it on the first line as: Subject: ...",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildRecruiterMessageSystemPrompt(): string {
  return [
    "You are a concise recruiter outreach writer. You write short, professional messages for LinkedIn or email.",
    "",
    "SAFETY RULES (never violate):",
    "1. Do NOT invent experience, degree, certification, employer, project, visa status, or years of experience.",
    "2. Do NOT use rejected keywords.",
    "3. Do NOT claim missing-evidence keywords.",
    "4. Keep it concise: 3-6 sentences.",
    "5. Tone: professional, direct, human. No fake enthusiasm.",
    "6. Every claim must be supported by the candidate's evidence.",
    "7. If evidence is missing, do not mention that keyword.",
    "",
    "Output the message as plain text. Optionally include a subject line on the first line prefixed with 'Subject: '.",
  ].join("\n");
}

function buildRecruiterMessagePrompt(data: PromptData): string {
  const approvedWithEvidence = data.approvedKeywords
    .filter((k) => k.evidence_status !== "missing" && k.evidence_status !== "unmapped")
    .map(
      (k) =>
        `  - ${k.keyword} (${k.category})${k.evidence_summary ? ` — evidence: ${k.evidence_summary}` : ""}`
    )
    .join("\n");

  const rejectedText = data.rejectedKeywords
    .map((k) => `  - ${k.keyword} (${k.category})`)
    .join("\n");

  const experienceText = data.context?.baseResume
    ? data.context.baseResume.experience.map((e) => `${e.title} at ${e.company}`).join("; ")
    : data.context?.uploadedResume
      ? data.context.uploadedResume.parsedExperience.map((e) => `${e.title} at ${e.company}`).join("; ")
      : "No resume experience available";

  return [
    "=== JOB ===",
    `Title: ${data.jobTitle ?? "Unknown"}`,
    `Company: ${data.companyName ?? "Unknown"}`,
    "",
    "=== CANDIDATE ===",
    `Name: ${data.candidateName ?? "Unknown"}`,
    `Experience: ${experienceText}`,
    data.context?.targetRoles ? `Target roles: ${data.context.targetRoles}` : "",
    "",
    "=== APPROVED KEYWORDS WITH EVIDENCE (use these) ===",
    approvedWithEvidence || "(none)",
    "",
    "=== REJECTED KEYWORDS (NEVER mention these) ===",
    rejectedText || "(none)",
    "",
    "=== INSTRUCTIONS ===",
    "Write a 3-6 sentence recruiter message. Mention 1-3 relevant approved keywords with evidence. Explain why the candidate is a good fit. Do NOT mention rejected keywords. Do NOT invent unsupported claims. Keep it concise and professional.",
    "",
    "Return the message text directly. If you want to include a subject line, put it on the first line as: Subject: ...",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSummaryPrompt(data: Omit<PromptData, "draftVersion" | "options">): string {
  const approvedWithEvidence = data.approvedKeywords
    .filter((k) => k.evidence_status !== "missing" && k.evidence_status !== "unmapped")
    .map((k) => `  - ${k.keyword} (${k.category})`)
    .join("\n");

  const missingEvidence = data.approvedKeywords
    .filter((k) => k.evidence_status === "missing" || k.evidence_status === "unmapped")
    .map((k) => `  - ${k.keyword}`)
    .join("\n");

  const rejectedList = data.rejectedKeywords.map((k) => `  - ${k.keyword}`).join("\n");

  return [
    "=== JOB ===",
    `Title: ${data.jobTitle ?? "Unknown"}`,
    `Company: ${data.companyName ?? "Unknown"}`,
    "",
    "=== CANDIDATE ===",
    `Name: ${data.candidateName ?? "Unknown"}`,
    "",
    "=== APPROVED KEYWORDS ===",
    `With evidence:\n${approvedWithEvidence || "(none)"}`,
    `Missing evidence:\n${missingEvidence || "(none)"}`,
    "",
    "=== REJECTED KEYWORDS ===",
    rejectedList || "(none)",
    "",
    "=== SUGGESTIONS ===",
    `Accepted: ${data.acceptedSuggestions.length}`,
    "",
    "Write a 2-4 sentence summary of this application packet's readiness. Note what is strong and what needs attention. Be factual and concise.",
  ].join("\n");
}

// ───────────────────────────────────────────────────────────────
// Response parsers
// ───────────────────────────────────────────────────────────────

function parseCoverLetterResponse(raw: string): { coverLetter: string; subject?: string } {
  const lines = raw.split("\n");
  let subject: string | undefined;
  let startIndex = 0;

  if (lines[0]?.startsWith("Subject:")) {
    subject = lines[0].replace("Subject:", "").trim();
    startIndex = 1;
  }

  const coverLetter = lines.slice(startIndex).join("\n").trim();
  return { coverLetter, subject };
}

function parseRecruiterMessageResponse(raw: string): { message: string; subject?: string } {
  const lines = raw.split("\n");
  let subject: string | undefined;
  let startIndex = 0;

  if (lines[0]?.startsWith("Subject:")) {
    subject = lines[0].replace("Subject:", "").trim();
    startIndex = 1;
  }

  const message = lines.slice(startIndex).join("\n").trim();
  return { message, subject };
}

function errorCoverLetter(message: string): CoverLetterResult {
  return { coverLetter: "", warnings: [message] };
}

function errorRecruiterMessage(message: string): RecruiterMessageResult {
  return { message: "", warnings: [message] };
}
