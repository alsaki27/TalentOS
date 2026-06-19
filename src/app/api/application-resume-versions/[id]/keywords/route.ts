// src/app/api/application-resume-versions/[id]/keywords/route.ts
// GET -> list keywords for the application associated with this resume version
// PATCH -> bulk update keyword statuses (delegates to application-level update)

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { supabase } from "@/lib/supabase";
import { listApplicationKeywords, bulkUpdateApplicationKeywordStatuses } from "@/server/repositories/applicationKeywordsRepository";

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
    return NextResponse.json({ keywords: [], applicationId: null });
  }

  const keywords = await listApplicationKeywords(applicationId);
  return NextResponse.json({ keywords, applicationId });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const applicationId = await findApplicationId(params.id);
  if (!applicationId) {
    return NextResponse.json({ error: "No application found for this resume version" }, { status: 404 });
  }

  const body = await req.json();
  const updates = body.updates;

  if (!Array.isArray(updates) || updates.length === 0) {
    return NextResponse.json({ error: "updates array is required" }, { status: 400 });
  }

  try {
    const results = await bulkUpdateApplicationKeywordStatuses(
      updates.map((u: any) => ({
        id: u.id,
        status: u.status,
        user_reason: u.user_reason ?? null,
        reviewed_by: context!.profile.user_id,
      }))
    );

    await logActivity({
      userId: context!.profile.user_id,
      actorName: context!.profile.display_name || context!.profile.email || undefined,
      type: "update",
      description: `Updated ${results.length} keyword status(es) for application ${applicationId}`,
      entityType: "application_job_keywords",
      entityId: applicationId,
      metadata: { updates: updates.map((u: any) => ({ id: u.id, status: u.status })) },
    });

    return NextResponse.json({ keywords: results });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to update keywords" }, { status: 500 });
  }
}
