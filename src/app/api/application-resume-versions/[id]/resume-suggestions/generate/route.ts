// src/app/api/application-resume-versions/[id]/resume-suggestions/generate/route.ts
// POST -> find/create application for this resume version, generate suggestions

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { isNeon } from "@/server/db";
import { queryOne } from "@/server/db/neon";
import { generateResumeSuggestions } from "@/server/services/resumeSuggestionService";
import { listSuggestionsByApplication } from "@/server/repositories/applicationResumeSuggestionsRepository";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const resumeVersionId = params.id;

  // Load resume version
  let appResume: any;
  if (isNeon()) {
    appResume = await queryOne(
      `SELECT candidate_id, target_job_id FROM application_resume_versions WHERE id = $1`,
      [resumeVersionId]
    );
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("application_resume_versions")
      .select("candidate_id, target_job_id")
      .eq("id", resumeVersionId)
      .single();
    appResume = res.data;
  }

  if (!appResume) {
    return NextResponse.json({ error: "Resume version not found" }, { status: 404 });
  }

  // Get job_id from target_job
  let targetJob: any;
  if (isNeon()) {
    targetJob = await queryOne(
      `SELECT job_id FROM target_jobs WHERE id = $1`,
      [appResume.target_job_id]
    );
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("target_jobs")
      .select("job_id")
      .eq("id", appResume.target_job_id)
      .single();
    targetJob = res.data;
  }

  if (!targetJob?.job_id) {
    return NextResponse.json(
      { error: "This resume version is not linked to a job in the masterlist. Create an application first or link a job." },
      { status: 400 }
    );
  }

  // Find or create application
  let application: any;
  if (isNeon()) {
    application = await queryOne(
      `SELECT id, candidate_id FROM applications WHERE candidate_id = $1 AND job_id = $2 ORDER BY applied_at DESC LIMIT 1`,
      [appResume.candidate_id, targetJob.job_id]
    );
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("applications")
      .select("id, candidate_id")
      .eq("candidate_id", appResume.candidate_id)
      .eq("job_id", targetJob.job_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    application = res.data;
  }

  if (!application) {
    let newApp: any;
    let createError: any;

    if (isNeon()) {
      newApp = await queryOne(
        `INSERT INTO applications (candidate_id, job_id, status, created_by) VALUES ($1, $2, $3, $4) RETURNING *`,
        [appResume.candidate_id, targetJob.job_id, "in_progress", context!.profile.user_id]
      );
      createError = newApp ? null : { message: "Failed to create application" };
    } else {
      const { supabase } = await import("@/lib/supabase");
      const res = await supabase
        .from("applications")
        .insert({
          candidate_id: appResume.candidate_id,
          job_id: targetJob.job_id,
          status: "in_progress",
          created_by: context!.profile.user_id,
        })
        .select()
        .single();
      newApp = res.data;
      createError = res.error;
    }

    if (createError || !newApp) {
      return NextResponse.json({ error: createError?.message || "Failed to create application" }, { status: 500 });
    }
    application = newApp;
  }

  // Generate suggestions
  const result = await generateResumeSuggestions(application.id, resumeVersionId, context!.profile.user_id);

  if (result.error) {
    const statusCode = result.error.includes("No AI provider") ? 503
      : result.error.includes("No approved keywords") ? 400
      : 500;
    return NextResponse.json({ error: result.error }, { status: statusCode });
  }

  await logActivity({
    userId: context!.profile.user_id,
    actorName: context!.profile.display_name || context!.profile.email || undefined,
    type: "create",
    description: `Generated ${result.suggestions.length} AI resume suggestions for application ${application.id}`,
    entityType: "application_resume_suggestions",
    entityId: application.id,
    metadata: { suggestion_count: result.suggestions.length, ai_used: result.aiAnalysisUsed, resume_version_id: resumeVersionId },
  });

  // Return fresh list
  const suggestions = await listSuggestionsByApplication(application.id);
  return NextResponse.json({ suggestions, applicationId: application.id, aiAnalysisUsed: result.aiAnalysisUsed });
}
