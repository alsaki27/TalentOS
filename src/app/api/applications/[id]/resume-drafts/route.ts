// src/app/api/applications/[id]/resume-drafts/route.ts
// GET  -> list resume versions/drafts for the application
// POST -> build a new draft from accepted suggestions

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { findApplicationById } from "@/server/repositories/applicationsRepository";
import { listResumeVersionsByApplication } from "@/server/repositories/applicationResumeVersionsRepository";
import { buildResumeDraftFromAcceptedSuggestions } from "@/server/services/resumeDraftBuilderService";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const applicationId = params.id;
  const app = await findApplicationById(applicationId);
  if (!app) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  // Get target_job_id
  const { data: targetJob } = await supabase
    .from("target_jobs")
    .select("id")
    .eq("candidate_id", app.candidate_id)
    .eq("job_id", app.job_id)
    .maybeSingle();

  const targetJobId = targetJob?.id;
  if (!targetJobId) {
    return NextResponse.json({ drafts: [], applicationId });
  }

  const drafts = await listResumeVersionsByApplication(app.candidate_id, targetJobId);
  return NextResponse.json({ drafts, applicationId });
}

import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const applicationId = params.id;
  const app = await findApplicationById(applicationId);
  if (!app) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  const body = await req.json();

  try {
    const result = await buildResumeDraftFromAcceptedSuggestions(applicationId, {
      baseResumeVersionId: body.base_resume_version_id ?? null,
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
        source_type: app.source_type,
        warnings: result.warnings,
      },
    });

    return NextResponse.json({
      resumeVersion: result.resumeVersion,
      appliedSuggestions: result.appliedSuggestions,
      skippedSuggestions: result.skippedSuggestions,
      warnings: result.warnings,
    });
  } catch (err: any) {
    const statusCode = err.message?.includes("No target job") ? 400 : 500;
    return NextResponse.json({ error: err.message || "Failed to build draft" }, { status: statusCode });
  }
}
