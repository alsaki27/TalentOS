// src/server/services/applicationPacketBuilderService.ts
// Builds a comprehensive application packet by gathering all related data,
// computing a readiness checklist, and generating warnings.
// NEVER invents data. Always uses repository abstractions.

import { findApplicationById } from "@/server/repositories/applicationsRepository";
import { findCandidateById } from "@/server/repositories/candidatesRepository";
import { findJobById } from "@/server/repositories/jobsRepository";
import { listApplicationKeywords } from "@/server/repositories/applicationKeywordsRepository";
import { listSuggestionsByApplication } from "@/server/repositories/applicationResumeSuggestionsRepository";
import {
  findResumeVersionById,
  getCurrentDraftForApplication,
} from "@/server/repositories/applicationResumeVersionsRepository";
import { listExportsByApplication } from "@/server/repositories/applicationResumeExportsRepository";
import {
  findPacketByApplicationId,
  upsertPacketForApplication,
  ApplicationPacketRow,
} from "@/server/repositories/applicationPacketsRepository";
import { findTargetJobByCandidateAndJob } from "@/server/repositories/targetJobsRepository";

export interface BuildPacketOptions {
  actorId?: string | null;
}

export interface BuildPacketResult {
  packet: ApplicationPacketRow | null;
  checklist: Record<string, "pass" | "warning" | "missing">;
  warnings: Array<{ type: string; severity: "warning" | "block"; message: string }>;
  summary: string;
  metadata: {
    candidateName?: string;
    jobTitle?: string;
    companyName?: string;
    approvedKeywordCount: number;
    rejectedKeywordCount: number;
    acceptedSuggestionCount: number;
    draftExists: boolean;
    exportExists: boolean;
  };
}

export async function buildApplicationPacket(
  applicationId: string,
  options: BuildPacketOptions = {}
): Promise<BuildPacketResult> {
  // 1. Load application
  const app = await findApplicationById(applicationId);
  if (!app) {
    return emptyResult("Application not found");
  }

  // 2. Load candidate
  const candidate = await findCandidateById(app.candidate_id);

  // 3. Load job
  const job = app.job_id ? await findJobById(app.job_id) : null;

  // 4. Load keywords
  const allKeywords = await listApplicationKeywords(applicationId);
  const approvedKeywords = allKeywords.filter((k) => k.status === "approved");
  const rejectedKeywords = allKeywords.filter((k) => k.status === "rejected");

  // 5. Load suggestions
  const suggestions = await listSuggestionsByApplication(applicationId);
  const acceptedSuggestions = suggestions.filter((s) => s.status === "accepted");

  // 6. Load existing packet
  const existingPacket = await findPacketByApplicationId(applicationId);

  // 7. Resolve target job and load draft
  let draftVersion: Awaited<ReturnType<typeof findResumeVersionById>> = null;
  let targetJobId: string | null = existingPacket?.target_job_id ?? null;

  if (existingPacket?.final_resume_version_id) {
    draftVersion = await findResumeVersionById(existingPacket.final_resume_version_id);
  } else if (app.job_id && candidate) {
    const targetJob = await findTargetJobByCandidateAndJob(app.candidate_id, app.job_id);
    if (targetJob) {
      targetJobId = targetJob.id;
      draftVersion = await getCurrentDraftForApplication(app.candidate_id, targetJob.id);
    }
  }

  // 8. Load exports
  const exports = await listExportsByApplication(applicationId);
  const validExports = exports.filter((e) => e.status === "created");

  // Build checklist
  const checklist: Record<string, "pass" | "warning" | "missing"> = {
    candidateSelected: candidate?.name ? "pass" : "missing",
    jobAttached:
      app.job_id ||
      (app.adhoc_job_data && Object.keys(app.adhoc_job_data).length > 0) ||
      app.adhoc_job_raw_text
        ? "pass"
        : "missing",
    keywordsGenerated: allKeywords.length > 0 ? "pass" : "missing",
    keywordsApproved: approvedKeywords.length > 0 ? "pass" : "missing",
    evidenceMapped:
      approvedKeywords.length === 0
        ? "missing"
        : approvedKeywords.every(
            (k) => k.evidence_status !== "missing" && k.evidence_status !== "unmapped"
          )
          ? "pass"
          : approvedKeywords.some(
              (k) => k.evidence_status === "missing" || k.evidence_status === "unmapped"
            )
            ? "warning"
            : "missing",
    resumeSuggestionsReviewed:
      suggestions.length > 0
        ? acceptedSuggestions.length > 0
          ? "pass"
          : "warning"
        : "missing",
    resumeDraftCreated: draftVersion ? "pass" : "missing",
    resumeExported: validExports.length > 0 ? "pass" : "missing",
    coverLetterGenerated: existingPacket?.cover_letter ? "pass" : "missing",
    recruiterMessageGenerated: existingPacket?.recruiter_message ? "pass" : "missing",
    finalReviewComplete:
      existingPacket?.packet_status === "approved" || existingPacket?.packet_status === "sent"
        ? "pass"
        : "missing",
  };

  // Build warnings
  const warnings: Array<{ type: string; severity: "warning" | "block"; message: string }> = [];

  if (validExports.length === 0) {
    warnings.push({
      type: "no_resume_export",
      severity: "warning",
      message: "No resume export (DOCX/PDF) has been generated for this application.",
    });
  }

  for (const kw of approvedKeywords) {
    if (kw.evidence_status === "missing" || kw.evidence_status === "unmapped") {
      warnings.push({
        type: "missing_evidence_keyword",
        severity: "warning",
        message: `Approved keyword "${kw.keyword}" has no supporting evidence.`,
      });
    }
  }

  for (const s of acceptedSuggestions) {
    if (s.truth_status === "fabrication_risk") {
      warnings.push({
        type: "high_risk_suggestion_accepted",
        severity: "block",
        message: `Accepted suggestion has fabrication risk: "${s.proposed_text.slice(0, 80)}${s.proposed_text.length > 80 ? "..." : ""}"`,
      });
    }
  }

  if (!candidate?.resume_url && !candidate?.resume_filename) {
    warnings.push({
      type: "no_original_resume",
      severity: "warning",
      message: "Candidate has no original resume uploaded.",
    });
  }

  if (!job?.title || !job?.company) {
    warnings.push({
      type: "no_company_job_title",
      severity: "warning",
      message: "Job title or company is missing.",
    });
  }

  if (!existingPacket?.cover_letter) {
    warnings.push({
      type: "cover_letter_missing",
      severity: "warning",
      message: "Cover letter has not been generated yet.",
    });
  }

  if (!existingPacket?.recruiter_message) {
    warnings.push({
      type: "recruiter_message_missing",
      severity: "warning",
      message: "Recruiter message has not been generated yet.",
    });
  }

  // Check rejected keywords in cover letter
  if (existingPacket?.cover_letter && rejectedKeywords.length > 0) {
    const coverLower = existingPacket.cover_letter.toLowerCase();
    for (const kw of rejectedKeywords) {
      if (coverLower.includes(kw.keyword.toLowerCase())) {
        warnings.push({
          type: "rejected_keyword_in_cover_letter",
          severity: "warning",
          message: `Rejected keyword "${kw.keyword}" appears in the cover letter.`,
        });
      }
    }
  }

  // Build summary
  const passCount = Object.values(checklist).filter((v) => v === "pass").length;
  const missingCount = Object.values(checklist).filter((v) => v === "missing").length;
  const warningCount = Object.values(checklist).filter((v) => v === "warning").length;

  const summaryParts: string[] = [];
  summaryParts.push(
    `Packet for ${candidate?.name ?? "Unknown Candidate"} — ${job?.title ?? "Unknown Role"} at ${job?.company ?? "Unknown Company"}.`
  );
  summaryParts.push(`${passCount}/${Object.keys(checklist).length} checklist items passing.`);
  if (missingCount > 0) summaryParts.push(`${missingCount} items missing.`);
  if (warningCount > 0) summaryParts.push(`${warningCount} items need attention.`);
  if (warnings.length > 0) summaryParts.push(`${warnings.length} warnings.`);
  if (warnings.some((w) => w.severity === "block")) {
    summaryParts.push("BLOCKING issues must be resolved before sending.");
  }

  const summary = summaryParts.join(" ");

  // Build metadata
  const metadata: BuildPacketResult["metadata"] = {
    candidateName: candidate?.name ?? undefined,
    jobTitle: job?.title ?? undefined,
    companyName: job?.company ?? undefined,
    approvedKeywordCount: approvedKeywords.length,
    rejectedKeywordCount: rejectedKeywords.length,
    acceptedSuggestionCount: acceptedSuggestions.length,
    draftExists: !!draftVersion,
    exportExists: validExports.length > 0,
  };

  // Upsert packet with built data
  const packet = await upsertPacketForApplication(applicationId, {
    target_job_id: targetJobId,
    base_resume_id: app.resume_id ?? null,
    final_resume_version_id: draftVersion?.id ?? null,
    resume_export_id: validExports[0]?.id ?? null,
    approved_keyword_ids: approvedKeywords.map((k) => k.id),
    rejected_keyword_ids: rejectedKeywords.map((k) => k.id),
    checklist,
    warnings: warnings as unknown[],
  });

  return {
    packet,
    checklist,
    warnings,
    summary,
    metadata,
  };
}

function emptyResult(reason: string): BuildPacketResult {
  return {
    packet: null,
    checklist: {},
    warnings: [{ type: "error", severity: "block", message: reason }],
    summary: reason,
    metadata: {
      approvedKeywordCount: 0,
      rejectedKeywordCount: 0,
      acceptedSuggestionCount: 0,
      draftExists: false,
      exportExists: false,
    },
  };
}
