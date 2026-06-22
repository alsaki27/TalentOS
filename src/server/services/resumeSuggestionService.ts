// src/server/services/resumeSuggestionService.ts
// AI-powered resume suggestion generation with truth-checking.
// Uses approved JD keywords + candidate evidence to suggest resume improvements.
// NEVER injects rejected keywords or invents unsupported experience.
//
// Flow:
//   1. Load approved keywords from application_job_keywords
//   2. Load rejected keywords (so AI knows what to exclude)
//   3. Build resume context (profile, evidence, resumes)
//   4. Call AI with structured prompt
//   5. Parse AI response into suggestion candidates
//   6. Run deterministic truth-check on each candidate
//   7. Persist suggestions to repository

import { getProviderForCategory } from "@/lib/ai";
import { textOf } from "@/lib/ai/provider";
import {
  findResumeVersionById,
  updateApplicationResumeVersion,
} from "@/server/repositories/applicationResumeVersionsRepository";
import {
  listApplicationKeywords,
  ApplicationKeywordRow,
} from "@/server/repositories/applicationKeywordsRepository";
import {
  createManySuggestions,
  CreateSuggestionInput,
  SuggestionType,
  SuggestionTargetSection,
  SuggestionTruthStatus,
} from "@/server/repositories/applicationResumeSuggestionsRepository";
import {
  buildResumeContext,
  findEvidenceForKeyword,
  ResumeContext,
} from "@/server/services/resumeContextService";
import { findApplicationById } from "@/server/repositories/applicationsRepository";

export interface GenerateSuggestionsResult {
  suggestions: CreateSuggestionInput[];
  aiAnalysisUsed: boolean;
  error?: string;
}

interface AiSuggestionCandidate {
  suggestion_type: string;
  target_section: string;
  target_subsection_id?: string | null;
  original_text?: string | null;
  proposed_text: string;
  ai_reasoning?: string | null;
}

interface AiSuggestionResponse {
  suggestions: AiSuggestionCandidate[];
}

// ───────────────────────────────────────────────────────────────
// Public entry point
// ───────────────────────────────────────────────────────────────

export async function generateResumeSuggestions(
  applicationId: string,
  resumeVersionId: string | null,
  createdByUserId?: string | null
): Promise<GenerateSuggestionsResult> {
  // 1. Load application
  const app = await findApplicationById(applicationId);
  if (!app) {
    return { suggestions: [], aiAnalysisUsed: false, error: "Application not found" };
  }

  // 2. Load keywords
  const allKeywords = await listApplicationKeywords(applicationId);
  const approvedKeywords = allKeywords.filter((k) => k.status === "approved");
  const rejectedKeywords = allKeywords.filter((k) => k.status === "rejected");

  if (approvedKeywords.length === 0) {
    return {
      suggestions: [],
      aiAnalysisUsed: false,
      error: "No approved keywords. Approve keywords in the JD Keywords panel first.",
    };
  }

  // 3. Build resume context
  const context = await buildResumeContext(app.candidate_id);

  // 4. Call AI
  const active = await getProviderForCategory("resume_studio");
  if (!active) {
    return {
      suggestions: [],
      aiAnalysisUsed: false,
      error: "No AI provider configured. Set ANTHROPIC_API_KEY or NVIDIA_API_KEY.",
    };
  }

  const prompt = buildSuggestionPrompt(
    context,
    approvedKeywords,
    rejectedKeywords,
    resumeVersionId
  );

  try {
    const response = await active.provider.send({
      system: buildSystemPrompt(),
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      tools: [],
    });
    const raw = textOf(response.content)
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    const parsed: AiSuggestionResponse = JSON.parse(raw);
    if (!Array.isArray(parsed.suggestions)) {
      return { suggestions: [], aiAnalysisUsed: true, error: "AI returned invalid format: missing suggestions array" };
    }

    // 5. Parse and truth-check
    const candidates = parsed.suggestions.map((s) =>
      parseAndValidateCandidate(s, approvedKeywords, rejectedKeywords, context, applicationId, resumeVersionId)
    );

    // 6. Persist
    const suggestions = await createManySuggestions(candidates);

    return {
      suggestions: suggestions.map((s) => ({
        application_id: s.application_id,
        resume_version_id: s.resume_version_id,
        keyword_id: s.keyword_id,
        suggestion_type: s.suggestion_type,
        target_section: s.target_section,
        target_subsection_id: s.target_subsection_id,
        original_text: s.original_text,
        proposed_text: s.proposed_text,
        ai_reasoning: s.ai_reasoning,
        truth_status: s.truth_status,
        truth_check_details: s.truth_check_details,
        source_evidence: s.source_evidence,
        status: s.status,
      })),
      aiAnalysisUsed: true,
    };
  } catch (err: any) {
    return {
      suggestions: [],
      aiAnalysisUsed: true,
      error: err.message ?? "AI suggestion generation failed",
    };
  }
}

// ───────────────────────────────────────────────────────────────
// Prompt builders
// ───────────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return [
    "You are a precise resume editor. You suggest improvements to help a candidate's resume better match a job description.",
    "",
    "RULES (never violate):",
    "1. NEVER invent experience, skills, or qualifications the candidate does not have.",
    "2. NEVER suggest adding rejected keywords.",
    "3. Only suggest changes that are supported by the candidate's evidence (resume, evidence bank, profile).",
    "4. For approved keywords the candidate lacks, suggest a TRUTH WARNING (not injection).",
    "5. For content changes, prefer rephrasing existing bullets to highlight relevant experience.",
    "6. For format improvements, suggest structural changes that improve readability or ATS scoring.",
    "7. Always provide clear reasoning for each suggestion.",
    "",
    "Suggestion types:",
    "- content_change: Rephrase, expand, or restructure existing content (e.g., make a bullet more achievement-oriented).",
    "- format_improvement: Structural changes (e.g., reorder sections, add section headers, improve formatting).",
    "- truth_warning: Alert that the candidate does NOT have evidence for an approved keyword. Do NOT suggest adding it.",
    "- keyword_injection: Add an approved keyword to the resume in a natural way (ONLY if evidence exists).",
    "- missing_evidence: Note that a keyword is approved but no evidence was found.",
    "",
    "Return ONLY a JSON object with no markdown fences, no extra text.",
  ].join("\n");
}

function buildSuggestionPrompt(
  context: ResumeContext,
  approved: ApplicationKeywordRow[],
  rejected: ApplicationKeywordRow[],
  resumeVersionId: string | null
): string {
  const evidenceText = buildEvidenceTextForPrompt(context);

  const approvedKeywordsText = approved
    .map((k) => {
      const ev = findEvidenceForKeyword(k.keyword, context);
      return `  - "${k.keyword}" (category: ${k.category}, importance: ${k.importance})${ev ? ` [evidence: ${ev.source} - ${ev.detail}]` : " [NO EVIDENCE]"}`;
    })
    .join("\n");

  const rejectedKeywordsText = rejected
    .map((k) => `  - "${k.keyword}" (category: ${k.category})`)
    .join("\n");

  const baseResumeSummary = context.baseResume
    ? [
        `Current resume summary: ${context.baseResume.summary ?? "(none)"}`,
        `Skills sections: ${context.baseResume.skills.map((s) => `${s.title}: ${s.skills.join(", ")}`).join("; ")}`,
        `Experience: ${context.baseResume.experience.map((e) => `${e.title} at ${e.company}`).join("; ")}`,
      ].join("\n")
    : "No base resume available.";

  return [
    "=== CANDIDATE EVIDENCE ===",
    evidenceText,
    "",
    "=== CURRENT RESUME ===",
    baseResumeSummary,
    "",
    "=== APPROVED KEYWORDS (MUST incorporate these) ===",
    approvedKeywordsText || "(none)",
    "",
    "=== REJECTED KEYWORDS (MUST NEVER suggest these) ===",
    rejectedKeywordsText || "(none)",
    "",
    "=== INSTRUCTIONS ===",
    "Generate 3-10 resume suggestions based on the approved keywords and candidate evidence.",
    "",
    "For each suggestion, return an object with these exact keys:",
    "- suggestion_type: one of content_change, format_improvement, truth_warning, keyword_injection, missing_evidence",
    "- target_section: one of summary, skills, experience, education, certifications, projects, header",
    "- target_subsection_id: optional string ID of the specific item (e.g., a skill group id or experience id)",
    "- original_text: the current text being changed (null for additions or format changes)",
    "- proposed_text: the suggested new text or change description",
    "- ai_reasoning: why this suggestion was made and how it connects to approved keywords",
    "",
    "Return ONLY this JSON shape:",
    '{"suggestions": [{"suggestion_type": "...", "target_section": "...", "target_subsection_id": "...", "original_text": "...", "proposed_text": "...", "ai_reasoning": "..."}]}',
    "",
    "If you have nothing useful to suggest, return an empty suggestions array.",
  ].join("\n");
}

function buildEvidenceTextForPrompt(context: ResumeContext): string {
  const parts: string[] = [];

  if (context.candidateName) parts.push(`Name: ${context.candidateName}`);
  if (context.targetRoles) parts.push(`Target roles: ${context.targetRoles}`);
  if (context.targetIndustries) parts.push(`Industries: ${context.targetIndustries.join(", ")}`);
  if (context.workAuthorization) parts.push(`Work authorization: ${context.workAuthorization}`);
  if (context.visaStatus) parts.push(`Visa status: ${context.visaStatus}`);
  if (context.notes) parts.push(`Notes: ${context.notes}`);
  if (context.skills) parts.push(`Profile skills: ${context.skills}`);

  if (context.evidenceBank.length > 0) {
    parts.push("\nEvidence Bank:");
    for (const ev of context.evidenceBank) {
      parts.push(`  - ${ev.title}${ev.description ? `: ${ev.description}` : ""}${ev.related_skills.length > 0 ? ` [skills: ${ev.related_skills.join(", ")}]` : ""}`);
    }
  }

  if (context.uploadedResume) {
    parts.push("\nUploaded Resume Skills:");
    parts.push(context.uploadedResume.parsedSkills.join(", "));
    parts.push("\nUploaded Resume Experience:");
    for (const exp of context.uploadedResume.parsedExperience.slice(0, 5)) {
      parts.push(`  ${exp.title} at ${exp.company} (${exp.startDate ?? ""} - ${exp.endDate ?? "present"})`);
      for (const b of exp.bullets.slice(0, 3)) parts.push(`    • ${b}`);
    }
  }

  return parts.join("\n");
}

// ───────────────────────────────────────────────────────────────
// Parse and truth-check AI candidates
// ───────────────────────────────────────────────────────────────

function parseAndValidateCandidate(
  candidate: AiSuggestionCandidate,
  approvedKeywords: ApplicationKeywordRow[],
  rejectedKeywords: ApplicationKeywordRow[],
  context: ResumeContext,
  applicationId: string,
  resumeVersionId: string | null
): CreateSuggestionInput {
  const type = validateSuggestionType(candidate.suggestion_type);
  const section = validateTargetSection(candidate.target_section);
  const proposedText = candidate.proposed_text?.trim() ?? "";
  const originalText = candidate.original_text?.trim() ?? null;
  const reasoning = candidate.ai_reasoning?.trim() ?? null;

  // Find matching keyword if any
  const matchingKeyword = approvedKeywords.find((k) =>
    proposedText.toLowerCase().includes(k.keyword.toLowerCase()) ||
    (reasoning?.toLowerCase() ?? "").includes(k.keyword.toLowerCase())
  );

  // Check for rejected keyword injection
  const rejectedMatch = rejectedKeywords.find((k) =>
    proposedText.toLowerCase().includes(k.keyword.toLowerCase())
  );
  if (rejectedMatch) {
    return {
      application_id: applicationId,
      resume_version_id: resumeVersionId,
      keyword_id: matchingKeyword?.id ?? null,
      suggestion_type: "truth_warning",
      target_section: section,
      target_subsection_id: candidate.target_subsection_id ?? null,
      original_text: originalText,
      proposed_text: `BLOCKED: AI attempted to inject rejected keyword "${rejectedMatch.keyword}". Original: ${proposedText}`,
      ai_reasoning: `AI attempted to suggest a rejected keyword. This was automatically blocked.`,
      truth_status: "fabrication_risk",
      truth_check_details: `Rejected keyword "${rejectedMatch.keyword}" was detected in the proposed text. Suggestion was blocked.`,
      source_evidence: null,
      status: "pending",
    };
  }

  // Truth-check based on suggestion type
  let truthStatus: SuggestionTruthStatus = "unverified";
  let truthDetails: string | null = null;
  let sourceEvidence: string | null = null;
  let finalType: SuggestionType = type;

  switch (type) {
    case "keyword_injection": {
      // Only allow keyword injection if evidence exists
      if (matchingKeyword) {
        const evidence = findEvidenceForKeyword(matchingKeyword.keyword, context);
        if (evidence) {
          truthStatus = "verified";
          truthDetails = `Evidence found: ${evidence.source} - ${evidence.detail}`;
          sourceEvidence = evidence.detail;
        } else {
          // No evidence → convert to missing_evidence
          finalType = "missing_evidence";
          truthStatus = "fabrication_risk";
          truthDetails = `No evidence found for keyword "${matchingKeyword.keyword}". Injection was blocked.`;
          sourceEvidence = null;
        }
      } else {
        // No matching keyword → check if the proposed text is supported by evidence
        const evidence = findEvidenceForKeyword(proposedText, context);
        if (evidence) {
          truthStatus = "verified";
          truthDetails = `Evidence found: ${evidence.source} - ${evidence.detail}`;
          sourceEvidence = evidence.detail;
        } else {
          finalType = "truth_warning";
          truthStatus = "fabrication_risk";
          truthDetails = "No direct keyword match and no evidence found for the proposed injection.";
        }
      }
      break;
    }

    case "content_change": {
      // Check if the proposed change is supported by evidence
      const evidence = findEvidenceForKeyword(proposedText, context);
      if (evidence) {
        truthStatus = "verified";
        truthDetails = `Evidence found: ${evidence.source} - ${evidence.detail}`;
        sourceEvidence = evidence.detail;
      } else if (originalText) {
        // Check if original text is in evidence (rephrasing is safer)
        const origEvidence = findEvidenceForKeyword(originalText, context);
        if (origEvidence) {
          truthStatus = "verified";
          truthDetails = `Original text has evidence (${origEvidence.source}). Rephrasing is safe.`;
          sourceEvidence = origEvidence.detail;
        } else {
          truthStatus = "unverified";
          truthDetails = "Neither original nor proposed text found in evidence. Review carefully.";
        }
      } else {
        truthStatus = "unverified";
        truthDetails = "No original text provided. Review carefully.";
      }
      break;
    }

    case "format_improvement": {
      // Format changes are structural, usually safe
      truthStatus = "verified";
      truthDetails = "Format/structural change does not alter factual content.";
      break;
    }

    case "truth_warning":
    case "missing_evidence": {
      // These are already warnings
      truthStatus = "verified";
      truthDetails = "This is a warning about missing evidence, not a factual claim.";
      break;
    }
  }

  return {
    application_id: applicationId,
    resume_version_id: resumeVersionId,
    keyword_id: matchingKeyword?.id ?? null,
    suggestion_type: finalType,
    target_section: section,
    target_subsection_id: candidate.target_subsection_id ?? null,
    original_text: originalText,
    proposed_text: proposedText,
    ai_reasoning: reasoning,
    truth_status: truthStatus,
    truth_check_details: truthDetails,
    source_evidence: sourceEvidence,
    status: "pending",
  };
}

// ───────────────────────────────────────────────────────────────
// Validation helpers
// ───────────────────────────────────────────────────────────────

const VALID_TYPES: SuggestionType[] = [
  "content_change",
  "format_improvement",
  "truth_warning",
  "keyword_injection",
  "missing_evidence",
];

const VALID_SECTIONS: SuggestionTargetSection[] = [
  "summary",
  "skills",
  "experience",
  "education",
  "certifications",
  "projects",
  "header",
];

function validateSuggestionType(type: string): SuggestionType {
  if (VALID_TYPES.includes(type as SuggestionType)) return type as SuggestionType;
  return "content_change";
}

function validateTargetSection(section: string): SuggestionTargetSection {
  if (VALID_SECTIONS.includes(section as SuggestionTargetSection)) return section as SuggestionTargetSection;
  return "summary";
}

// ───────────────────────────────────────────────────────────────
// Bulk status update (accept/reject)
// ───────────────────────────────────────────────────────────────

export async function acceptSuggestion(
  suggestionId: string,
  userId: string
): Promise<void> {
  const { updateSuggestion } = await import("@/server/repositories/applicationResumeSuggestionsRepository");
  await updateSuggestion(suggestionId, { status: "accepted" });
}

export async function rejectSuggestion(
  suggestionId: string,
  userId: string,
  notes?: string
): Promise<void> {
  const { updateSuggestion } = await import("@/server/repositories/applicationResumeSuggestionsRepository");
  await updateSuggestion(suggestionId, { status: "rejected", user_notes: notes ?? null });
}

// ───────────────────────────────────────────────────────────────
// Apply an accepted suggestion to a resume version
// Uses repository for data access, not direct supabase calls.
// Safe when used on a DRAFT version only.
// ───────────────────────────────────────────────────────────────

export async function applySuggestionToResume(
  suggestionId: string,
  resumeVersionId: string
): Promise<{ ok: boolean; error?: string }> {
  const { findSuggestionById } = await import("@/server/repositories/applicationResumeSuggestionsRepository");
  const suggestion = await findSuggestionById(suggestionId);
  if (!suggestion) return { ok: false, error: "Suggestion not found" };
  if (suggestion.status !== "accepted") return { ok: false, error: "Suggestion must be accepted first" };

  // Load current resume content via repository
  const appResume = await findResumeVersionById(resumeVersionId);
  if (!appResume) return { ok: false, error: "Resume version not found" };

  const content = structuredClone(appResume.content);

  // Apply the change based on target_section and proposed_text
  const applied = applyChangeToContent(content, suggestion);
  if (!applied) return { ok: false, error: "Could not apply suggestion to resume content" };

  // Save updated content via repository
  await updateApplicationResumeVersion(resumeVersionId, { content });

  // Mark suggestion as applied
  const { updateSuggestion } = await import("@/server/repositories/applicationResumeSuggestionsRepository");
  await updateSuggestion(suggestionId, { status: "applied" });

  return { ok: true };
}

function applyChangeToContent(
  content: Record<string, unknown>,
  suggestion: { target_section: string; target_subsection_id: string | null; original_text: string | null; proposed_text: string }
): boolean {
  const section = suggestion.target_section;
  const sectionData = content[section];
  if (sectionData === undefined || sectionData === null) return false;

  // For text-based sections (summary, header fields)
  if (typeof sectionData === "string" && suggestion.original_text) {
    if (sectionData === suggestion.original_text) {
      content[section] = suggestion.proposed_text;
      return true;
    }
    return false;
  }

  // For array-based sections (skills, experience, education, etc.)
  if (Array.isArray(sectionData)) {
    for (const item of sectionData) {
      if (typeof item !== "object" || !item) continue;

      // Match by subsection_id if provided
      if (suggestion.target_subsection_id && (item as any).id !== suggestion.target_subsection_id) {
        continue;
      }

      // Try to find and replace text fields
      const textFields = ["text", "degree", "name", "description", "title", "company", "school"];
      for (const field of textFields) {
        if (typeof (item as any)[field] === "string" && (item as any)[field] === suggestion.original_text) {
          (item as any)[field] = suggestion.proposed_text;
          return true;
        }
      }

      // Try to replace in bullets array
      if (Array.isArray((item as any).bullets)) {
        for (const bullet of (item as any).bullets) {
          if (typeof bullet === "string" && bullet === suggestion.original_text) {
            const idx = (item as any).bullets.indexOf(bullet);
            (item as any).bullets[idx] = suggestion.proposed_text;
            return true;
          }
          if (typeof bullet === "object" && bullet && bullet.text === suggestion.original_text) {
            bullet.text = suggestion.proposed_text;
            return true;
          }
        }
      }

      // Try to replace in skills array
      if (Array.isArray((item as any).skills)) {
        for (let i = 0; i < (item as any).skills.length; i++) {
          if (typeof (item as any).skills[i] === "string" && (item as any).skills[i] === suggestion.original_text) {
            (item as any).skills[i] = suggestion.proposed_text;
            return true;
          }
        }
      }
    }
  }

  // For summary object with text field
  if (typeof sectionData === "object" && sectionData && !Array.isArray(sectionData)) {
    if (suggestion.original_text && (sectionData as any).text === suggestion.original_text) {
      (sectionData as any).text = suggestion.proposed_text;
      return true;
    }
  }

  return false;
}
