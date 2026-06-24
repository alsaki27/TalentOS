// src/server/services/resumeExportService.ts
// Export resume drafts to DOCX, PDF, and Markdown.
// Wraps existing render functions (renderResumeDocx, renderResumePdf) and adds:
//   - history tracking via application_resume_exports
//   - safety checks before export
//   - activity logging
//   - professional file naming
//
// Cloudflare note: renderResumeDocx uses the 'docx' npm package (Node-only).
// renderResumePdf uses @react-pdf/renderer (also Node-only).
// Both will need adapter review during a Cloudflare Workers migration.

import { findResumeVersionById } from "@/server/repositories/applicationResumeVersionsRepository";
import { findApplicationById } from "@/server/repositories/applicationsRepository";
import {
  createExport,
  markExportFailed,
  ApplicationResumeExportRow,
} from "@/server/repositories/applicationResumeExportsRepository";
import { ResumeDocument } from "@/lib/falood/types";

// Cloudflare Workers: PDF/DOCX export disabled — @react-pdf/renderer and docx are Node.js-only
// and exceed the free tier bundle size limit. Re-enable by externalizing to a Node.js microservice.

export interface ExportOptions {
  onePage?: boolean;
  includeSummary?: boolean;
  includeProjects?: boolean;
  atsFriendly?: boolean;
}

export interface ExportResult {
  exportRecord: ApplicationResumeExportRow;
  buffer: Buffer;
  fileName: string;
  contentType: string;
}

export interface ExportSafetyCheck {
  passed: boolean;
  warnings: string[];
  errors: string[];
}

// ───────────────────────────────────────────────────────────────
// Safety checks before export
// ───────────────────────────────────────────────────────────────

export async function runExportSafetyChecks(
  resumeVersionId: string,
  applicationId: string
): Promise<ExportSafetyCheck> {
  const warnings: string[] = [];
  const errors: string[] = [];

  const version = await findResumeVersionById(resumeVersionId);
  if (!version) {
    errors.push("Resume version not found");
    return { passed: false, warnings, errors };
  }

  const app = await findApplicationById(applicationId);
  if (!app) {
    errors.push("Application not found");
    return { passed: false, warnings, errors };
  }

  const content = version.content as unknown as ResumeDocument;

  // Check empty resume
  const hasContent =
    content.header?.fullName?.trim() ||
    content.summary?.text?.trim() ||
    content.skills?.length > 0 ||
    content.experience?.length > 0 ||
    content.education?.length > 0;

  if (!hasContent) {
    errors.push("Resume draft is empty — no exportable content found");
  }

  // Check missing candidate name
  if (!content.header?.fullName?.trim()) {
    warnings.push("Candidate name is missing — file name will be generic");
  }

  // Check for high-risk suggestions (from the application)
  let riskySuggestions: any[] = [];
  if (isNeon()) {
    const suggestions = await query(
      "SELECT id, suggestion_type, truth_status, status, proposed_text FROM application_resume_suggestions WHERE application_id = $1 AND status = $2 AND truth_status = $3",
      [applicationId, "accepted", "fabrication_risk"]
    );
    riskySuggestions = suggestions ?? [];
  } else {
    const { supabase } = await import("@/lib/supabase");
    const { data: suggestions } = await supabase
      .from("application_resume_suggestions")
      .select("id, suggestion_type, truth_status, status, proposed_text")
      .eq("application_id", applicationId)
      .eq("status", "accepted")
      .eq("truth_status", "fabrication_risk");
    riskySuggestions = (suggestions ?? []) as any[];
  }

  if (riskySuggestions.length > 0) {
    warnings.push(
      `${riskySuggestions.length} accepted suggestion(s) have fabrication risk and were not applied to the draft. Review before sending to client.`
    );
  }

  return { passed: errors.length === 0, warnings, errors };
}

import { isNeon } from "@/server/db";
import { query, queryOne, execute } from "@/server/db/neon";

// ───────────────────────────────────────────────────────────────
// File name builder
// ───────────────────────────────────────────────────────────────

function buildFileName(
  content: ResumeDocument,
  applicationId: string,
  exportType: "docx" | "pdf" | "markdown" | "text"
): string {
  const candidateName = (content.header?.fullName ?? "Candidate")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  const ext = exportType === "markdown" ? "md" : exportType;
  return `${candidateName}_Resume_${ext}`;
}

// ───────────────────────────────────────────────────────────────
// Content formatter (prepares for export)
// ───────────────────────────────────────────────────────────────

function formatContentForExport(
  content: ResumeDocument,
  options: ExportOptions
): ResumeDocument {
  // Clone to avoid mutating original
  const formatted: ResumeDocument = JSON.parse(JSON.stringify(content));

  // Remove AI slop words if ATS-friendly
  if (options.atsFriendly) {
    const slopWords = ["passionate", "dynamic", "results-driven", "synergy", "leverage", "utilize", "rockstar", "ninja", "guru"];
    const slopRegex = new RegExp(`\\b(${slopWords.join("|")})\\b`, "gi");

    if (formatted.summary?.text) {
      formatted.summary.text = formatted.summary.text.replace(slopRegex, "").replace(/\s+/g, " ").trim();
    }

    for (const exp of formatted.experience) {
      for (const b of exp.bullets) {
        b.text = b.text.replace(slopRegex, "").replace(/\s+/g, " ").trim();
      }
    }

    for (const proj of formatted.projects ?? []) {
      for (const b of proj.bullets) {
        b.text = b.text.replace(slopRegex, "").replace(/\s+/g, " ").trim();
      }
    }
  }

  // Remove projects if not included
  if (!options.includeProjects) {
    formatted.projects = [];
  }

  // Remove summary if not included
  if (!options.includeSummary && formatted.summary) {
    formatted.summary = undefined;
  }

  return formatted;
}

// ───────────────────────────────────────────────────────────────
// Export functions
// ───────────────────────────────────────────────────────────────

export async function exportResumeAsDocx(
  applicationId: string,
  resumeVersionId: string,
  options: ExportOptions = {},
  createdByUserId?: string | null
): Promise<ExportResult> {
  return exportResume(applicationId, resumeVersionId, "docx", options, createdByUserId);
}

export async function exportResumeAsPdf(
  applicationId: string,
  resumeVersionId: string,
  options: ExportOptions = {},
  createdByUserId?: string | null
): Promise<ExportResult> {
  return exportResume(applicationId, resumeVersionId, "pdf", options, createdByUserId);
}

export async function exportResumeAsMarkdown(
  applicationId: string,
  resumeVersionId: string,
  options: ExportOptions = {},
  createdByUserId?: string | null
): Promise<ExportResult> {
  return exportResume(applicationId, resumeVersionId, "markdown", options, createdByUserId);
}

async function exportResume(
  applicationId: string,
  resumeVersionId: string,
  exportType: "docx" | "pdf" | "markdown" | "text",
  options: ExportOptions,
  createdByUserId?: string | null
): Promise<ExportResult> {
  // 1. Load resume version
  const version = await findResumeVersionById(resumeVersionId);
  if (!version) throw new Error("Resume version not found");

  const content = formatContentForExport(version.content as unknown as ResumeDocument, options);
  const fileName = buildFileName(content, applicationId, exportType);

  // 2. Create export record (pending)
  const exportRecord = await createExport({
    application_id: applicationId,
    resume_version_id: resumeVersionId,
    export_type: exportType,
    file_name: fileName,
    storage_provider: "generated",
    created_by: createdByUserId,
  });

  // 3. Generate file
  let buffer: Buffer;
  try {
    if (exportType === "docx" || exportType === "pdf") {
      throw new Error(`${exportType.toUpperCase()} export is temporarily disabled on this deployment. Use Markdown export instead.`);
    } else if (exportType === "markdown" || exportType === "text") {
      buffer = Buffer.from(renderResumeAsMarkdownText(content), "utf-8");
    } else {
      throw new Error(`Unsupported export type: ${exportType}`);
    }
  } catch (err: any) {
    await markExportFailed(exportRecord.id, err.message ?? "Export generation failed");
    throw new Error(`Export generation failed: ${err.message ?? err}`);
  }

  // 4. Update record with file size
  if (isNeon()) {
    await execute(
      "UPDATE application_resume_exports SET file_size_bytes = $1 WHERE id = $2",
      [buffer.length, exportRecord.id]
    );
  } else {
    const { supabase } = await import("@/lib/supabase");
    await supabase
      .from("application_resume_exports")
      .update({ file_size_bytes: buffer.length })
      .eq("id", exportRecord.id);
  }

  const contentTypeMap: Record<string, string> = {
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pdf: "application/pdf",
    markdown: "text/markdown",
    text: "text/plain",
  };

  return {
    exportRecord: { ...exportRecord, file_size_bytes: buffer.length },
    buffer,
    fileName,
    contentType: contentTypeMap[exportType],
  };
}

// ───────────────────────────────────────────────────────────────
// Markdown renderer (for markdown/text export)
// ───────────────────────────────────────────────────────────────

function renderResumeAsMarkdownText(content: ResumeDocument): string {
  const lines: string[] = [];

  lines.push(`# ${content.header.fullName}`);
  const contact = [
    content.header.location,
    content.header.phone,
    content.header.email,
    content.header.linkedin,
    content.header.github,
  ].filter(Boolean).join(" | ");
  if (contact) lines.push(contact);
  lines.push("");

  if (content.summary?.text) {
    lines.push(content.summary.text);
    lines.push("");
  }

  if (content.skills.length > 0) {
    lines.push("## Technical Skills");
    for (const s of content.skills) {
      lines.push(`**${s.title}:** ${s.skills.join(", ")}`);
    }
    lines.push("");
  }

  if (content.experience.length > 0) {
    lines.push("## Professional Experience");
    for (const exp of content.experience) {
      const dates = exp.endDate ? `${exp.startDate} – ${exp.endDate}` : `${exp.startDate} – Present`;
      lines.push(`### ${exp.title} — ${exp.company}${exp.location ? `, ${exp.location}` : ""}`);
      lines.push(`*${dates}*`);
      for (const b of exp.bullets) lines.push(`- ${b.text}`);
      lines.push("");
    }
  }

  if (content.projects && content.projects.length > 0) {
    lines.push("## Projects");
    for (const p of content.projects) {
      const techs = p.technologies?.length ? ` (${p.technologies.join(", ")})` : "";
      lines.push(`### ${p.name}${techs}`);
      if (p.description) lines.push(p.description);
      for (const b of p.bullets) lines.push(`- ${b.text}`);
      lines.push("");
    }
  }

  if (content.education.length > 0) {
    lines.push("## Education");
    for (const edu of content.education) {
      const date = edu.graduationDate ? ` (${edu.graduationDate})` : "";
      lines.push(`- ${edu.degree} — ${edu.school}${edu.location ? `, ${edu.location}` : ""}${date}`);
    }
    lines.push("");
  }

  if (content.certifications && content.certifications.length > 0) {
    lines.push("## Certifications");
    for (const c of content.certifications) {
      const issuer = c.issuer ? ` — ${c.issuer}` : "";
      const date = c.date ? ` (${c.date})` : "";
      lines.push(`- ${c.name}${issuer}${date}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
