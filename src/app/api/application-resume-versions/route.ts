// src/app/api/application-resume-versions/route.ts
// GET  -> list by candidateId query param
// POST -> create from baseResumeId + targetJobId. Copy base_resume.content into content, set status='draft', created_by

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { logActivity } from "@/lib/activity";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const candidateId = new URL(req.url).searchParams.get("candidateId");
  if (!candidateId) return NextResponse.json({ error: "candidateId is required" }, { status: 400 });

  const { data, error } = await supabase
    .from("application_resume_versions")
    .select("id, candidate_id, base_resume_id, target_job_id, status, ats_score, truth_score, one_page_fit_score, created_by, created_at, updated_at")
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const body = await req.json();
  const baseResumeId = body.baseResumeId as string | undefined;
  const targetJobId = body.targetJobId as string | undefined;

  if (!baseResumeId || !targetJobId) {
    return NextResponse.json({ error: "baseResumeId and targetJobId are required" }, { status: 400 });
  }

  const { data: baseResume, error: baseError } = await supabase
    .from("base_resumes")
    .select("content, candidate_id")
    .eq("id", baseResumeId)
    .single();

  if (baseError || !baseResume) {
    return NextResponse.json({ error: "Base resume not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("application_resume_versions")
    .insert({
      candidate_id: baseResume.candidate_id,
      base_resume_id: baseResumeId,
      target_job_id: targetJobId,
      content: baseResume.content,
      status: "draft",
      created_by: context!.profile.user_id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logActivity({
    userId: context!.profile.user_id,
    actorName: context!.profile.display_name || context!.profile.email || undefined,
    type: "create",
    description: `Created application resume version from base resume ${baseResumeId}`,
    entityType: "application_resume_version",
    entityId: data.id,
    metadata: { base_resume_id: baseResumeId, target_job_id: targetJobId, candidate_id: baseResume.candidate_id },
  });

  return NextResponse.json(data, { status: 201 });
}
