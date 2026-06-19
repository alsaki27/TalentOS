// src/app/api/application-resume-versions/[id]/resume-drafts/route.ts
// GET  -> list drafts for the application associated with this resume version
// POST -> build a draft from the application associated with this resume version

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { supabase } from "@/lib/supabase";
import { listResumeVersionsByApplication } from "@/server/repositories/applicationResumeVersionsRepository";
import { buildResumeDraftFromAcceptedSuggestions } from "@/server/services/resumeDraftBuilderService";

export const dynamic = "force-dynamic";

async function findApplicationId(resumeVersionId: string): Promise<string | null> {
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

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const applicationId = await findApplicationId(params.id);
  if (!applicationId) {
    return NextResponse.json({ drafts: [], applicationId: null });
  }

  const { data: app } = await supabase
    .from("applications")
    .select("candidate_id, job_id")
    .eq("id", applicationId)
    .single();

  const { data: targetJob } = await supabase
    .from("target_jobs")
    .select("id")
    .eq("candidate_id", app.candidate_id)
    .eq("job_id", app.job_id)
    .maybeSingle();

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
