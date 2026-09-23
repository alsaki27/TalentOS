// src/server/services/resumeDraftBuilderService.ts
// Build a resume draft from accepted suggestions.
// NEVER overwrites original or base resume. Always creates a new draft version,
// or updates an existing draft if mode === 'update_existing_draft'.
//
// Safety:
//   - Never invents experience.
//   - Never adds rejected keywords.
//   - Never adds missing-evidence claims.
//   - Skips suggestions that cannot be safely matched.
//   - Only applies suggestions with status='accepted' and truth_status !== 'fabrication_risk'.

import { findApplicationById } from "@/server/repositories/applicationsRepository";
import {
  findResumeVersionById,
  createApplicationResumeVersion,
  updateApplicationResumeVersion,
  getCurrentDraftForApplication,
  ApplicationResumeVersionRow,
  ResumeVersionSourceType,
} from "@/server/repositories/applicationResumeVersionsRepository";
import {
  listSuggestionsByApplication,
  updateSuggestion,
  ApplicationResumeSuggestionRow,
} from "@/server/repositories/applicationResumeSuggestionsRepository";
import { findLatestOriginalResume } from "@/server/repositories/candidateEvidenceRepository";
import { findLatestBaseResumeFull } from "@/server/repositories/baseResumesRepository";
import { query, queryOne } from "@/server/db/neon";
import { buildResumeDocumentFromParsedResume } from "@/lib/falood/seedFromParsedResume";
import type { ResumeDocument } from "@/lib/falood/types";

// applications.source_type has a broader domain (e.g. "copilot_adhoc",
// "email_confirmation") than ResumeVersionSourceType — only pass through
// values that are actually valid resume-version source types, default to
// "base_resume" otherwise.
const RESUME_VERSION_SOURCE_TYPES: readonly ResumeVersionSourceType[] = ["base_resume", "original_resume", "blank", "manual"];
function toResumeVersionSourceType(value: string | null | undefined): ResumeVersionSourceType {
  return RESUME_VERSION_SOURCE_TYPES.includes(value as ResumeVersionSourceType) ? (value as ResumeVersionSourceType) : "base_resume";
}

export interface BuildResumeDraftOptions {
  baseResumeVersionId?: string | null;
  mode?: "new_draft" | "update_existing_draft";
  includeSuggestionIds?: string[];
  excludeSuggestionIds?: string[];
  createdByUserId?: string | null;
}

export interface BuildResumeDraftResult {
  resumeVersion: ApplicationResumeVersionRow;
  appliedSuggestions: AppliedSuggestion[];
  skippedSuggestions: SkippedSuggestion[];
  warnings: string[];
}

export interface AppliedSuggestion {
  id: string;
  type: string;
  section: string;
  proposed_text: string;
  original_text: string | null;
}

export interface SkippedSuggestion {
  id: string;
  type: string;
  reason: string;
}

// ───────────────────────────────────────────────────────────────
// Public entry point
// ───────────────────────────────────────────────────────────────

export async function buildResumeDraftFromAcceptedSuggestions(
  applicationId: string,
  options: BuildResumeDraftOptions = {}
): Promise<BuildResumeDraftResult> {
  const { mode = "new_draft", includeSuggestionIds, excludeSuggestionIds, createdByUserId } = options;

  // 1. Load application
  const app = await findApplicationById(applicationId);
  if (!app) throw new Error("Application not found");

  const candidateId = app.candidate_id;
  const jobId = app.job_id;

  // 2. Determine target_job_id for the resume version
  const targetJobId = await resolveTargetJobId(applicationId, jobId, candidateId);
  if (!targetJobId) throw new Error("No target job linked to this application. Cannot create a resume version without a target job.");

  // 3. Load source content based on source_type
  const sourceResult = await loadSourceContent(app.source_type, candidateId, options.baseResumeVersionId);
  let draftContent = structuredClone(sourceResult.content);

  // 4. Load accepted suggestions
  const allSuggestions = await listSuggestionsByApplication(applicationId);
  const eligibleSuggestions = allSuggestions.filter((s) => {
    if (s.status !== "accepted") return false;
    if (s.truth_status === "fabrication_risk" && s.suggestion_type !== "truth_warning" && s.suggestion_type !== "missing_evidence") return false;
    if (includeSuggestionIds && includeSuggestionIds.length > 0 && !includeSuggestionIds.includes(s.id)) return false;
    if (excludeSuggestionIds && excludeSuggestionIds.length > 0 && excludeSuggestionIds.includes(s.id)) return false;
    return true;
  });

  // 5. Apply suggestions to the draft content copy
  const applied: AppliedSuggestion[] = [];
  const skipped: SkippedSuggestion[] = [];
  const warnings: string[] = [];

  for (const suggestion of eligibleSuggestions) {
    const result = applySuggestionToContent(draftContent, suggestion);
    if (result.applied) {
      applied.push({
        id: suggestion.id,
        type: suggestion.suggestion_type,
        section: suggestion.target_section,
        proposed_text: suggestion.proposed_text,
        original_text: suggestion.original_text,
      });
    } else {
      skipped.push({
        id: suggestion.id,
        type: suggestion.suggestion_type,
        reason: result.reason,
      });
      warnings.push(`Skipped suggestion ${suggestion.id}: ${result.reason}`);
    }
  }

  // 6. Create or update the draft version
  let resumeVersion: ApplicationResumeVersionRow;

  if (mode === "update_existing_draft") {
    const existing = await getCurrentDraftForApplication(candidateId, targetJobId);
    if (existing) {
      resumeVersion = await updateApplicationResumeVersion(existing.id, {
        content: draftContent,
        title: existing.title ?? "Updated Draft",
      });
    } else {
      // No existing draft — create new
      resumeVersion = await createApplicationResumeVersion({
        candidate_id: candidateId,
        base_resume_id: sourceResult.baseResumeId,
        target_job_id: targetJobId,
        content: draftContent,
        source_type: toResumeVersionSourceType(app.source_type),
        title: sourceResult.title,
        version_label: "draft",
        created_by: createdByUserId,
      });
    }
  } else {
    // new_draft — always create a new version
    resumeVersion = await createApplicationResumeVersion({
      candidate_id: candidateId,
      base_resume_id: sourceResult.baseResumeId,
      target_job_id: targetJobId,
      content: draftContent,
      source_type: toResumeVersionSourceType(app.source_type),
      title: sourceResult.title,
      version_label: "draft",
      created_by: createdByUserId,
    });
  }

  // 7. Mark applied suggestions as "applied" only after draft is successfully created
  for (const a of applied) {
    await updateSuggestion(a.id, { status: "applied" });
  }

  return {
    resumeVersion,
    appliedSuggestions: applied,
    skippedSuggestions: skipped,
    warnings,
  };
}

// ───────────────────────────────────────────────────────────────
// Source content loader
// ───────────────────────────────────────────────────────────────

interface SourceContentResult {
  content: Record<string, unknown>;
  baseResumeId: string | null;
  title: string;
}

async function loadSourceContent(
  sourceType: string | null,
  candidateId: string,
  baseResumeVersionId?: string | null
): Promise<SourceContentResult> {
  // If a specific base resume version is provided, use it
  if (baseResumeVersionId) {
    const version = await findResumeVersionById(baseResumeVersionId);
    if (version) {
      return {
        content: structuredClone(version.content),
        baseResumeId: version.base_resume_id,
        title: version.title ?? "Draft from version",
      };
    }
  }

  switch (sourceType) {
    case "base_resume": {
      // Load latest base resume for candidate
      const baseResume = await findLatestBaseResumeFull(candidateId);
      if (baseResume) {
        return {
          content: structuredClone(baseResume.content as Record<string, unknown>),
          baseResumeId: baseResume.id,
          title: `Draft from ${baseResume.name ?? "Base Resume"}`,
        };
      }
      // Fall through to blank if no base resume
      return createBlankContent();
    }

    case "original_resume": {
      // Load latest uploaded resume parsed content
      const resume = await findLatestOriginalResume(candidateId);
      if (resume?.parsed_json) {
        return {
          content: parsedJsonToResumeDocument(resume.parsed_json as Record<string, unknown>) as unknown as Record<string, unknown>,
          baseResumeId: null,
          title: "Draft from Original Resume",
        };
      }
      return createBlankContent();
    }

    case "blank": {
      return createBlankContent();
    }

    case "manual": {
      // Try to find an existing draft version for this candidate
      const version = await queryOne<{ id: string; content: unknown; title: string | null; base_resume_id: string | null }>(
        `SELECT id, content, title, base_resume_id
         FROM application_resume_versions
         WHERE candidate_id = $1 AND status = 'draft'
         ORDER BY updated_at DESC
         LIMIT 1`,
        [candidateId]
      );
      if (version) {
        return {
          content: structuredClone(version.content as Record<string, unknown>),
          baseResumeId: version.base_resume_id,
          title: version.title ?? "Draft from Manual",
        };
      }
      return createBlankContent();
    }

    default: {
      // Try base resume first, then blank
      const baseResume = await findLatestBaseResumeFull(candidateId);
      if (baseResume) {
        return {
          content: structuredClone(baseResume.content as Record<string, unknown>),
          baseResumeId: baseResume.id,
          title: `Draft from ${baseResume.name ?? "Base Resume"}`,
        };
      }
      return createBlankContent();
    }
  }
}

function createBlankContent(): SourceContentResult {
  return {
    content: {
      header: { fullName: "" },
      skills: [],
      experience: [],
      education: [],
      formatting: {
        styleId: "skarion_compact_professional",
      pageFormat: "a4",
        fontFamily: "Calibri",
        fontSize: 10.5,
        marginTop: 0.5,
        marginRight: 0.5,
        marginBottom: 0.5,
        marginLeft: 0.5,
        sectionSpacing: 8,
        bulletSpacing: 2,
        lineHeight: 1.15,
      },
    },
    baseResumeId: null,
    title: "Blank Draft",
  };
}

function parsedJsonToResumeDocument(parsed: Record<string, unknown>): ResumeDocument {
  return buildResumeDocumentFromParsedResume(
    parsed,
    { name: "" },
    {
      styleId: "skarion_compact_professional",
      pageFormat: "a4",
      fontFamily: "Calibri",
      fontSize: 10.5,
      marginTop: 0.5,
      marginRight: 0.5,
      marginBottom: 0.5,
      marginLeft: 0.5,
      sectionSpacing: 8,
      bulletSpacing: 2,
      lineHeight: 1.15,
    },
  );
}

// ───────────────────────────────────────────────────────────────
// Apply a single suggestion to a content copy
// ───────────────────────────────────────────────────────────────

interface ApplyResult {
  applied: boolean;
  reason: string;
}

function applySuggestionToContent(
  content: Record<string, unknown>,
  suggestion: ApplicationResumeSuggestionRow
): ApplyResult {
  // Skip truth warnings and missing evidence (they are display-only, not content changes)
  if (suggestion.suggestion_type === "truth_warning" || suggestion.suggestion_type === "missing_evidence") {
    return { applied: false, reason: "Suggestion type is a warning only, not a content change" };
  }

  // For format improvements, return a message that manual formatting is needed
  if (suggestion.suggestion_type === "format_improvement") {
    return { applied: false, reason: "Format improvements require manual application in the editor" };
  }

  const section = suggestion.target_section;
  const sectionData = content[section];
  if (sectionData === undefined || sectionData === null) {
    return { applied: false, reason: `Section "${section}" not found in resume content` };
  }

  // For text-based sections (summary, header fields)
  if (typeof sectionData === "string" && suggestion.original_text) {
    if (sectionData === suggestion.original_text) {
      content[section] = suggestion.proposed_text;
      return { applied: true, reason: "" };
    }
    return { applied: false, reason: "Original text not found in section" };
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
          return { applied: true, reason: "" };
        }
      }

      // Try to replace in bullets array
      if (Array.isArray((item as any).bullets)) {
        for (const bullet of (item as any).bullets) {
          if (typeof bullet === "string" && bullet === suggestion.original_text) {
            const idx = (item as any).bullets.indexOf(bullet);
            (item as any).bullets[idx] = suggestion.proposed_text;
            return { applied: true, reason: "" };
          }
          if (typeof bullet === "object" && bullet && bullet.text === suggestion.original_text) {
            bullet.text = suggestion.proposed_text;
            return { applied: true, reason: "" };
          }
        }
      }

      // Try to replace in skills array
      if (Array.isArray((item as any).skills)) {
        for (let i = 0; i < (item as any).skills.length; i++) {
          if (typeof (item as any).skills[i] === "string" && (item as any).skills[i] === suggestion.original_text) {
            (item as any).skills[i] = suggestion.proposed_text;
            return { applied: true, reason: "" };
          }
        }
      }
    }
  }

  // For summary object with text field
  if (typeof sectionData === "object" && sectionData && !Array.isArray(sectionData)) {
    if (suggestion.original_text && (sectionData as any).text === suggestion.original_text) {
      (sectionData as any).text = suggestion.proposed_text;
      return { applied: true, reason: "" };
    }
  }

  return { applied: false, reason: "Could not match original text in the specified section" };
}

// ───────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────

async function resolveTargetJobId(
  _applicationId: string,
  jobId: string | null,
  candidateId: string
): Promise<string | null> {
  if (jobId) {
    // Find the target_jobs row for this candidate + job
    const row = await queryOne<{ id: string }>(
      `SELECT id FROM target_jobs WHERE candidate_id = $1 AND job_id = $2 LIMIT 1`,
      [candidateId, jobId]
    );
    if (row?.id) return row.id;
  }
  // Try to find any target_job for this candidate
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM target_jobs WHERE candidate_id = $1 LIMIT 1`,
    [candidateId]
  );
  return row?.id ?? null;
}

// ───────────────────────────────────────────────────────────────
// Export the apply function for reuse (e.g., by apply route)
// ───────────────────────────────────────────────────────────────

export { applySuggestionToContent };
