"use client";
// src/lib/falood/clientExport.tsx
// Browser-side PDF/DOCX generation - the actual rendering never touches the
// Cloudflare Worker for the DOCX path. docx ships a browser-compatible build
// (Packer.toBlob()) that works with plain Web APIs. The PDF path
// (skarionPdfDocument.tsx, jsPDF-based) is also called server-side now by the
// AI pipeline's page-fit measurement (see hiringPanel.ts/finalPolish.ts) -
// jsPDF is small enough for that to be safe, unlike the old @react-pdf/renderer
// PDF path this file used to call, which is why that's gone.
//
// Generation produces a Blob in the browser. In the application Studio flow the
// SharePoint archive is written before the browser download is released, so a
// downloaded file can never be mistaken for an archived application resume.

// docx is loaded via dynamic import() inside generateResumeDocxBlob, not as a
// static top-level import here. A static import of @react-pdf/renderer once got
// pulled into the *server* Worker script bundle despite "use client" (confirmed
// via a real deploy attempt: wrangler's own size-limit error listed
// node_modules/@react-pdf/pdfkit/lib/pdfkit.browser.js, 900 KiB, as one of the 5
// largest dependencies "included in your script" - pushing the Worker over
// Cloudflare's 3 MiB free-plan script size limit at the time). A true dynamic
// import() inside a function body, not a static `import ... from`, is what
// actually keeps a module out of the eagerly-bundled graph for client-only code.
import { ResumeDocument } from "@/lib/falood/types";
import { normalizeResumeContentForExport, resumifyResumeDataToExportDocument } from "@/lib/falood/resumeDocumentAdapters";

export { normalizeResumeContentForExport, resumifyResumeDataToExportDocument };

export async function generateResumePdfBlob(content: ResumeDocument): Promise<Blob> {
  const { renderResumePdfDoc } = await import("@/lib/falood/skarionPdfDocument");
  const doc = renderResumePdfDoc(content);
  return doc.output("blob");
}

export async function generateResumeDocxBlob(content: ResumeDocument): Promise<Blob> {
  const [{ Packer }, { buildResumeDocxDocument }] = await Promise.all([
    import("docx"),
    import("@/lib/falood/docxExport"),
  ]);
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
  archiveLabel?: string;
}

export interface UploadExportResult {
  id: string;
  url: string;
}

/**
 * Uploads the exact generated blob to the configured resume archive (SharePoint
 * in production) and records it in application_resume_exports. Called after the
 * user's own download has already happened (see exportAndDownloadResume) - a
 * rejection here means the re-downloadable archive copy failed, not the export
 * itself.
 */
export async function uploadResumeExport(params: UploadExportParams): Promise<UploadExportResult> {
  const form = new FormData();
  form.append("applicationId", params.applicationId);
  form.append("resumeVersionId", params.resumeVersionId);
  form.append("exportType", params.exportType);
  form.append("fileName", params.fileName);
  if (params.archiveLabel) form.append("archiveLabel", params.archiveLabel);
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

/**
 * Generates the file, archives the exact same blob in SharePoint, and only then
 * releases the browser download. This makes the archive the source of truth
 * for the application's PDF link and prevents untracked local exports.
 */
export async function exportAndDownloadResume(
  rawContent: any,
  format: "pdf" | "docx",
  uploadContext: { applicationId: string; resumeVersionId: string }
): Promise<UploadExportResult> {
  const content = normalizeResumeContentForExport(rawContent);
  const blob = format === "pdf" ? await generateResumePdfBlob(content) : await generateResumeDocxBlob(content);
  const fileName = fileNameFor(content, format);
  let archived: UploadExportResult;
  try {
    archived = await uploadResumeExport({
      applicationId: uploadContext.applicationId,
      resumeVersionId: uploadContext.resumeVersionId,
      exportType: format,
      blob,
      fileName,
    });
  } catch (err: any) {
    throw new Error(
      `${format.toUpperCase()} was not downloaded because the SharePoint archive failed: ${err?.message || "unknown error"}`
    );
  }
  downloadBlob(blob, fileName);
  return archived;
}
