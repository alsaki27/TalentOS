"use client";
// src/lib/falood/clientExport.tsx
// Browser-side PDF/DOCX generation - the actual rendering never touches the
// Cloudflare Worker. @react-pdf/renderer and docx both ship browser-compatible
// builds (pdf(<Doc/>).toBlob() and Packer.toBlob()) that work with plain Web APIs,
// so the original high-fidelity templates run unchanged here instead of needing a
// degraded substitute or an external Node service.
//
// Generation produces a Blob immediately for download; uploading that blob to R2
// for history/re-download is a separate, best-effort step (see uploadResumeExport)
// that the caller can fire in the background without blocking the download.

import { pdf } from "@react-pdf/renderer";
import { Packer } from "docx";
import { SkarionResumePdf } from "@/lib/falood/skarionPdfDocument";
import { buildResumeDocxDocument } from "@/lib/falood/docxExport";
import { ResumeDocument, ResumeFormatting } from "@/lib/falood/types";

const DEFAULT_FORMATTING: ResumeFormatting = {
  styleId: "default",
  pageFormat: "letter",
  fontFamily: "Helvetica",
  fontSize: 10.5,
  marginTop: 0.5,
  marginRight: 0.5,
  marginBottom: 0.5,
  marginLeft: 0.5,
  sectionSpacing: 8,
  bulletSpacing: 2,
  lineHeight: 1.15,
};

/**
 * Several resume-studio pages predate the current shared ResumeDocument type and
 * have their own slightly different local interface for the same underlying JSONB
 * content (missing `formatting` entirely; `projects[].title` instead of `.name`).
 * The runtime data is the same JSONB column either way - this just reconciles the
 * type-level drift so callers can pass whatever shape they have without each page
 * needing its own adapter.
 */
export function normalizeResumeContentForExport(content: any): ResumeDocument {
  return {
    ...content,
    formatting: { ...DEFAULT_FORMATTING, ...(content.formatting ?? {}) },
    projects: (content.projects ?? []).map((p: any) => ({
      ...p,
      name: p.name ?? p.title ?? "",
    })),
  };
}

export async function generateResumePdfBlob(content: ResumeDocument): Promise<Blob> {
  return pdf(<SkarionResumePdf content={content} />).toBlob();
}

export async function generateResumeDocxBlob(content: ResumeDocument): Promise<Blob> {
  const doc = buildResumeDocxDocument(content);
  return Packer.toBlob(doc);
}

function fileNameFor(content: ResumeDocument, extension: "pdf" | "docx"): string {
  const safe = content.header.fullName.replace(/[^a-z0-9]+/gi, "_");
  return `${safe}_resume.${extension}`;
}

/** Triggers an immediate browser download of an already-generated blob - no network round-trip. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface UploadExportParams {
  applicationId: string;
  resumeVersionId: string;
  exportType: "pdf" | "docx";
  blob: Blob;
  fileName: string;
}

export interface UploadExportResult {
  id: string;
  url: string;
}

/**
 * Uploads a generated blob to R2 and records it in application_resume_exports.
 * Best-effort: callers should not block the user's download on this succeeding -
 * generate + downloadBlob() first, then call this to persist a re-downloadable copy.
 */
export async function uploadResumeExport(params: UploadExportParams): Promise<UploadExportResult> {
  const form = new FormData();
  form.append("applicationId", params.applicationId);
  form.append("resumeVersionId", params.resumeVersionId);
  form.append("exportType", params.exportType);
  form.append("fileName", params.fileName);
  form.append("file", params.blob, params.fileName);

  const res = await fetch("/api/applications/exports", {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? "Export upload failed");
  }
  return res.json();
}

/** Convenience wrapper: generate, download immediately, then upload in the background for history. */
export async function exportAndDownloadResume(
  rawContent: any,
  format: "pdf" | "docx",
  uploadContext?: { applicationId: string; resumeVersionId: string }
): Promise<void> {
  const content = normalizeResumeContentForExport(rawContent);
  const blob = format === "pdf" ? await generateResumePdfBlob(content) : await generateResumeDocxBlob(content);
  const fileName = fileNameFor(content, format);
  downloadBlob(blob, fileName);

  if (uploadContext) {
    uploadResumeExport({
      applicationId: uploadContext.applicationId,
      resumeVersionId: uploadContext.resumeVersionId,
      exportType: format,
      blob,
      fileName,
    }).catch((err) => {
      // Best-effort - the user already has their download, don't surface this as a failure.
      console.error("Failed to save export to history:", err);
    });
  }
}
