// src/app/api/applications/[id]/resume-exports/route.ts
// GET  -> list export history for the application
// POST -> create a new export (DOCX, PDF, or Markdown)

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { findApplicationById } from "@/server/repositories/applicationsRepository";
import { listExportsByApplication } from "@/server/repositories/applicationResumeExportsRepository";
import {
  exportResumeAsDocx,
  exportResumeAsPdf,
  exportResumeAsMarkdown,
  runExportSafetyChecks,
} from "@/server/services/resumeExportService";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const applicationId = params.id;
  const app = await findApplicationById(applicationId);
  if (!app) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  const exports = await listExportsByApplication(applicationId);
  return NextResponse.json({ exports, applicationId });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const applicationId = params.id;
  const app = await findApplicationById(applicationId);
  if (!app) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  const body = await req.json();
  const resumeVersionId = body.resume_version_id as string | undefined;
  const exportType = body.export_type as "docx" | "pdf" | "markdown" | undefined;
  const options = body.options ?? {};

  if (!resumeVersionId || !exportType) {
    return NextResponse.json({ error: "resume_version_id and export_type are required" }, { status: 400 });
  }

  const safety = await runExportSafetyChecks(resumeVersionId, applicationId);
  if (!safety.passed) {
    return NextResponse.json({
      error: "Export safety checks failed",
      errors: safety.errors,
      warnings: safety.warnings,
    }, { status: 400 });
  }

  try {
    let result;
    if (exportType === "docx") {
      result = await exportResumeAsDocx(applicationId, resumeVersionId, options, context!.profile.user_id);
    } else if (exportType === "pdf") {
      result = await exportResumeAsPdf(applicationId, resumeVersionId, options, context!.profile.user_id);
    } else if (exportType === "markdown") {
      result = await exportResumeAsMarkdown(applicationId, resumeVersionId, options, context!.profile.user_id);
    } else {
      return NextResponse.json({ error: "export_type must be docx, pdf, or markdown" }, { status: 400 });
    }

    await logActivity({
      userId: context!.profile.user_id,
      actorName: context!.profile.display_name || context!.profile.email || undefined,
      type: "create",
      description: `Exported resume as ${exportType.toUpperCase()} for application ${applicationId}`,
      entityType: "application_resume_export",
      entityId: result.exportRecord.id,
      metadata: {
        application_id: applicationId,
        resume_version_id: resumeVersionId,
        export_type: exportType,
        file_name: result.fileName,
        file_size: result.buffer.length,
        warnings: safety.warnings,
      },
    });

    return new NextResponse(new Blob([new Uint8Array(result.buffer)]), {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
      },
    });
  } catch (err: any) {
    await logActivity({
      userId: context!.profile.user_id,
      actorName: context!.profile.display_name || context!.profile.email || undefined,
      type: "create",
      description: `Failed to export resume as ${exportType.toUpperCase()} for application ${applicationId}`,
      entityType: "application_resume_export",
      entityId: applicationId,
      metadata: { application_id: applicationId, resume_version_id: resumeVersionId, export_type: exportType, error: err.message },
    });

    return NextResponse.json({
      error: err.message || "Export failed",
      warnings: safety.warnings,
    }, { status: 500 });
  }
}
