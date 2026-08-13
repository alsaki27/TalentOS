"use client";
// src/lib/falood/clientExport.tsx
// Browser-side PDF/DOCX generation - the actual rendering never touches the
// Cloudflare Worker. @react-pdf/renderer and docx both ship browser-compatible
// builds (pdf(<Doc/>).toBlob() and Packer.toBlob()) that work with plain Web APIs,
// so the original high-fidelity templates run unchanged here instead of needing a
// degraded substitute or an external Node service.
//
// Generation produces a Blob immediately for download; uploading that blob to the
// configured archive (SharePoint in production)
// for history/re-download is a separate, best-effort step (see uploadResumeExport)
// that the caller can fire in the background without blocking the download.

// @react-pdf/renderer and docx are loaded via dynamic import() inside each
// function below, not as static top-level imports here. A static import got
// pulled into the *server* Worker script bundle despite "use client" (confirmed
// via a real deploy attempt: wrangler's own size-limit error listed
// node_modules/@react-pdf/pdfkit/lib/pdfkit.browser.js, 900 KiB, as one of the 5
// largest dependencies "included in your script" - pushing the Worker over
// Cloudflare's 3 MiB free-plan script size limit). A true dynamic import() inside
// a function body, not a static `import ... from`, is what actually keeps a
// module out of the eagerly-bundled graph.
import { ResumeDocument, ResumeFormatting } from "@/lib/falood/types";

const DEFAULT_FORMATTING: ResumeFormatting = {
  styleId: "default",
  pageFormat: "a4",
  fontFamily: "Helvetica",
  fontSize: 10.5,
  marginTop: 0.5,
  marginRight: 0.5,
  marginBottom: 0.5,
  marginLeft: 0.5,
  sectionSpacing: 5,
  bulletSpacing: 1,
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

/** Converts the legacy Resumify editor shape into the canonical PDF document shape. */
export function resumifyResumeDataToExportDocument(data: any): ResumeDocument {
  const personalInfo = data?.personalInfo ?? {};
  const skills = data?.skills ?? {};
  const groups = Array.isArray(skills.categorized) ? skills.categorized : [];
  const simpleSkills = Array.isArray(skills.simple) ? skills.simple : [];
  const skillSections = groups.length > 0
    ? groups.map((group: any, index: number) => ({
        id: group?.id || `skill-${index}`,
        title: group?.name || "Skills",
        skills: Array.isArray(group?.skills) ? group.skills : [],
      }))
    : [{ id: "skills", title: "Skills", skills: simpleSkills }];

  return normalizeResumeContentForExport({
    header: {
      fullName: typeof personalInfo.fullName === "string" ? personalInfo.fullName : "",
      location: personalInfo.location,
      phone: personalInfo.phone,
      email: personalInfo.email,
      linkedin: personalInfo.linkedin,
      github: personalInfo.github,
      portfolio: personalInfo.website,
    },
    summary: typeof data?.summary === "string" && data.summary.trim()
      ? { id: "summary", text: data.summary }
      : undefined,
    skills: skillSections,
    experience: Array.isArray(data?.experience) ? data.experience.map((entry: any, index: number) => ({
      id: entry?.id || `experience-${index}`,
      title: entry?.jobTitle || "",
      company: entry?.company || "",
      location: entry?.location,
      startDate: entry?.startDate || "",
      endDate: entry?.current ? undefined : entry?.endDate,
      bullets: (Array.isArray(entry?.bulletPoints) ? entry.bulletPoints : []).map((text: unknown, bulletIndex: number) => ({
        id: `experience-${index}-bullet-${bulletIndex}`,
        text: typeof text === "string" ? text : "",
      })),
    })) : [],
    education: Array.isArray(data?.education) ? data.education.map((entry: any, index: number) => ({
      id: entry?.id || `education-${index}`,
      degree: entry?.degree || "",
      school: entry?.institution || "",
      location: entry?.location,
      graduationDate: entry?.graduationYear,
    })) : [],
    projects: Array.isArray(data?.projects) ? data.projects.map((entry: any, index: number) => ({
      id: entry?.id || `project-${index}`,
      title: entry?.title || "",
      description: entry?.description,
      bullets: [],
      technologies: Array.isArray(entry?.technologies) ? entry.technologies : [],
    })) : [],
    customSections: Array.isArray(data?.customSections) ? data.customSections.map((section: any, index: number) => ({
      id: section?.id || `custom-${index}`,
      title: section?.title || "Additional Information",
      bullets: String(section?.content || "").split(/\r?\n/).filter(Boolean).map((text, bulletIndex) => ({
        id: `custom-${index}-bullet-${bulletIndex}`,
        text,
      })),
    })) : [],
    certifications: [],
    formatting: {
      pageFormat: data?.pageFormat === "letter" ? "letter" : "a4",
      fontFamily: typeof data?.fontFamily === "string" ? data.fontFamily : "Inter",
      fontSize: typeof data?.fontSize === "number" ? data.fontSize : 10,
      marginTop: typeof data?.pagePadding === "number" ? data.pagePadding : 0.5,
      marginRight: typeof data?.pagePadding === "number" ? data.pagePadding : 0.5,
      marginBottom: typeof data?.pagePadding === "number" ? data.pagePadding : 0.5,
      marginLeft: typeof data?.pagePadding === "number" ? data.pagePadding : 0.5,
      styleId: "resumify-version",
      sectionSpacing: 5,
      bulletSpacing: 1,
      lineHeight: 1.15,
    },
  });
}

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
 * Generates the file, downloads it immediately, then archives the same blob so
 * it can be re-downloaded later (this is also what makes the "View PDF" link
 * and pdf_available flag in the candidate profile work). The user's download
 * always happens first and unconditionally - an archive failure is reported
 * via a distinctly-worded error (caught and re-thrown here) so a caller's
 * catch block never tells the user their export failed when it actually
 * succeeded and only the background archive copy did not.
 */
export async function exportAndDownloadResume(
  rawContent: any,
  format: "pdf" | "docx",
  uploadContext?: { applicationId: string; resumeVersionId: string }
): Promise<UploadExportResult | null> {
  const content = normalizeResumeContentForExport(rawContent);
  const blob = format === "pdf" ? await generateResumePdfBlob(content) : await generateResumeDocxBlob(content);
  const fileName = fileNameFor(content, format);
  downloadBlob(blob, fileName);

  if (uploadContext) {
    try {
      return await uploadResumeExport({
        applicationId: uploadContext.applicationId,
        resumeVersionId: uploadContext.resumeVersionId,
        exportType: format,
        blob,
        fileName,
      });
    } catch (err: any) {
      throw new Error(
        `${format.toUpperCase()} downloaded, but saving a re-downloadable copy failed: ${err?.message || "unknown error"}`
      );
    }
  }
  return null;
}
