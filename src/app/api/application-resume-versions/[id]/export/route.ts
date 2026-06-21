// src/app/api/application-resume-versions/[id]/export/route.ts
// POST -> export a resume version directly (studio convenience route)

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { isNeon } from "@/server/db";
import { queryOne } from "@/server/db/neon";
import { findResumeVersionById } from "@/server/repositories/applicationResumeVersionsRepository";
import {
  exportResumeAsDocx,
  exportResumeAsPdf,
  exportResumeAsMarkdown,
  runExportSafetyChecks,
} from "@/server/services/resumeExportService";

export const dynamic = "force-dynamic";

async function findApplicationId(resumeVersionId: string): Promise<string | null> {
  if (isNeon()) {
    const appResume = await queryOne(
      `SELECT candidate_id, target_job_id FROM application_resume_versions WHERE id = $1`,
      [resumeVersionId]
    );
    if (!appResume) return null;

    const targetJob = await queryOne(
      `SELECT job_id FROM target_jobs WHERE id = $1`,
      [appResume.target_job_id]
    );
    if (!targetJob?.job_id) return null;

    const application = await queryOne(
      `SELECT id FROM applications WHERE candidate_id = $1 AND job_id = $2 ORDER BY applied_at DESC LIMIT 1`,
      [appResume.candidate_id, targetJob.job_id]
    );
    return application?.id ?? null;
  } else {
    const { supabase } = await import("@/lib/supabase");
    const { data: appResume } = await supabase
      .from("application_resume_versions")
      .select("candidate_id, target_job_id")
      .eq("id", resumeVersionId)
      .single();
    if (!appResume) return null;

    const { data: targetJob } = await supabase
      .from("target_jobs")
      .select("job_id")
      .eq("id", appResume.target_job_id)
      .single();
    if (!targetJob?.job_id) return null;

    const { data: application } = await supabase
      .from("applications")
      .select("id")
      .eq("candidate_id", appResume.candidate_id)
      .eq("job_id", targetJob.job_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return application?.id ?? null;
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const resumeVersionId = params.id;
  const body = await req.json();
  const exportType = body.export_type as "docx" | "pdf" | "markdown" | undefined;
  const options = body.options ?? {};

  if (!exportType) {
    return NextResponse.json({ error: "export_type is required" }, { status: 400 });
  }

  const applicationId = await findApplicationId(resumeVersionId);
  if (!applicationId) {
    return NextResponse.json({ error: "No application found for this resume version" }, { status: 404 });
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

    return NextResponse.json({ error: err.message || "Export failed" }, { status: 500 });
  }
}
