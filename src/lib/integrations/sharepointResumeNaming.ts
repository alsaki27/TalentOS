// src/lib/integrations/sharepointResumeNaming.ts
// Single source of truth for where a tailored resume PDF lives in SharePoint.
// Both the manual "Export" button in Falood Studio
// (api/applications/exports/route.ts) and the automatic archive-on-finalization
// hook (finalizationService.ts, via resumeSharePointArchiveService.ts) build
// their upload path through buildResumeSharePointPath, so a resume's SharePoint
// location is always derived the same way no matter which path put it there —
// the frontend "Sharepoint" link button only has to trust one shape.
//
// Folder:   resumes/{candidateName}/{jobId}/
// Filename: {candidateName} - {companyName} - {jobTitle} - candidate-{candidateId} - resume-{resumeVersionId}.pdf
//
// candidateId and resumeVersionId are always the raw, exact
// candidates.id / application_resume_versions.id UUIDs (never hashed or
// shortened), so a SharePoint text search on either id finds the file.

export function safeSegment(value: string | null | undefined, fallback: string): string {
  const cleaned = (value ?? "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._ -]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || fallback).slice(0, 90);
}

export interface ResumeSharePointNameInput {
  candidateId: string;
  candidateName: string | null | undefined;
  jobId: string | null | undefined;
  companyName: string | null | undefined;
  jobTitle: string | null | undefined;
  resumeVersionId: string;
  /** Appended before the extension for a non-default archive slot (e.g. a version label). Normal exports omit this and overwrite the same SharePoint file. */
  variantLabel?: string | null;
}

export function buildResumeSharePointPath(input: ResumeSharePointNameInput): { path: string; fileName: string; folderPath: string } {
  const candidateName = safeSegment(input.candidateName, "Candidate");
  const companyName = safeSegment(input.companyName, "Company");
  const jobTitle = safeSegment(input.jobTitle, "Application");
  // finalizeWorkflow (the automatic path) always has a real job_id by the time
  // it archives — see finalizationService.ts's target_jobs lookup, which
  // throws earlier if applications.job_id is null. The manual export path can
  // still see a null job_id for older ad-hoc applications never linked to a
  // job row, hence this fallback.
  const jobFolder = input.jobId ? input.jobId : "unlinked";
  const variantSuffix = input.variantLabel ? ` - ${safeSegment(input.variantLabel, "version")}` : "";
  const fileName = `${candidateName} - ${companyName} - ${jobTitle} - candidate-${input.candidateId} - resume-${input.resumeVersionId}${variantSuffix}.pdf`;
  const folderPath = `${candidateName}/${jobFolder}`;
  return { path: `${folderPath}/${fileName}`, fileName, folderPath };
}
