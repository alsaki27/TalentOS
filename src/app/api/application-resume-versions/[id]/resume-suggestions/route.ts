// src/app/api/application-resume-versions/[id]/resume-suggestions/route.ts
// GET  -> list suggestions for the application associated with this resume version
// PATCH -> bulk update suggestion statuses (accept/reject)

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { isNeon } from "@/server/db";
import { queryOne } from "@/server/db/neon";
import {
  listSuggestionsByApplication,
  updateSuggestion,
} from "@/server/repositories/applicationResumeSuggestionsRepository";

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
    return NextResponse.json({ suggestions: [], applicationId: null });
  }

  const suggestions = await listSuggestionsByApplication(applicationId);
  return NextResponse.json({ suggestions, applicationId });
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

  const results = [];
  for (const u of updates as any[]) {
    const updated = await updateSuggestion(u.id, {
      status: u.status,
      user_notes: u.user_notes ?? null,
    });
    results.push(updated);
  }

  await logActivity({
    userId: context!.profile.user_id,
    actorName: context!.profile.display_name || context!.profile.email || undefined,
    type: "update",
    description: `Updated ${results.length} suggestion status(es) for application ${applicationId}`,
    entityType: "application_resume_suggestions",
    entityId: applicationId,
    metadata: { updates: updates.map((u: any) => ({ id: u.id, status: u.status })) },
  });

  return NextResponse.json({ suggestions: results });
}
