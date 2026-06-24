// src/app/api/application-resume-versions/[id]/resume-drafts/route.ts
// GET  -> list drafts for the application associated with this resume version
// POST -> build a draft from the application associated with this resume version

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { isNeon } from "@/server/db";
import { queryOne } from "@/server/db/neon";
import { listResumeVersionsByApplication } from "@/server/repositories/applicationResumeVersionsRepository";
import { buildResumeDraftFromAcceptedSuggestions } from "@/server/services/resumeDraftBuilderService";

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

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const applicationId = await findApplicationId(params.id);
  if (!applicationId) {
    return NextResponse.json({ drafts: [], applicationId: null });
  }

  let app: any;
  let targetJob: any;

  if (isNeon()) {
    app = await queryOne(
      `SELECT candidate_id, job_id FROM applications WHERE id = $1`,
      [applicationId]
    );
    if (app) {
      targetJob = await queryOne(
        `SELECT id FROM target_jobs WHERE candidate_id = $1 AND job_id = $2`,
        [app.candidate_id, app.job_id]
      );
    }
  } else {
    const { supabase } = await import("@/lib/supabase");
    const appRes = await supabase
      .from("applications")
      .select("candidate_id, job_id")
      .eq("id", applicationId)
      .single();
    app = appRes.data;

    if (app) {
      const tjRes = await supabase
        .from("target_jobs")
        .select("id")
        .eq("candidate_id", app.candidate_id)
        .eq("job_id", app.job_id)
        .maybeSingle();
      targetJob = tjRes.data;
    }
  }

  const drafts = targetJob?.id
    ? await listResumeVersionsByApplication(app.candidate_id, targetJob.id)
    : [];

  return NextResponse.json({ drafts, applicationId });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const applicationId = await findApplicationId(params.id);
  if (!applicationId) {
    return NextResponse.json({ error: "No application found for this resume version" }, { status: 404 });
  }

  const body = await req.json();

  try {
    const result = await buildResumeDraftFromAcceptedSuggestions(applicationId, {
      baseResumeVersionId: body.base_resume_version_id ?? params.id,
      mode: body.mode ?? "new_draft",
      includeSuggestionIds: body.include_suggestion_ids ?? undefined,
      excludeSuggestionIds: body.exclude_suggestion_ids ?? undefined,
      createdByUserId: context!.profile.user_id,
    });

    await logActivity({
      userId: context!.profile.user_id,
      actorName: context!.profile.display_name || context!.profile.email || undefined,
      type: "create",
      description: `Built resume draft from ${result.appliedSuggestions.length} accepted suggestion(s) for application ${applicationId}`,
      entityType: "application_resume_version",
      entityId: result.resumeVersion.id,
      metadata: {
        application_id: applicationId,
        resume_version_id: result.resumeVersion.id,
        applied_count: result.appliedSuggestions.length,
        skipped_count: result.skippedSuggestions.length,
      },
    });

    return NextResponse.json({
      resumeVersion: result.resumeVersion,
      appliedSuggestions: result.appliedSuggestions,
      skippedSuggestions: result.skippedSuggestions,
      warnings: result.warnings,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to build draft" }, { status: 500 });
  }
}
