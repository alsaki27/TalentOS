// src/app/api/application-packets/route.ts
// GET  -> list by candidateId query param
// POST -> create application packet

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { logActivity } from "@/lib/activity";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const candidateId = new URL(req.url).searchParams.get("candidateId");
  if (!candidateId) return NextResponse.json({ error: "candidateId is required" }, { status: 400 });

  const { data: applications } = await supabase
    .from("applications")
    .select("id")
    .eq("candidate_id", candidateId);

  const applicationIds = (applications ?? []).map((a: any) => a.id as string);
  if (applicationIds.length === 0) return NextResponse.json([]);

  const { data, error } = await supabase
    .from("application_packets")
    .select("*, applications(status, review_status, review_note, jobs(title, company))")
    .in("application_id", applicationIds)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const body = await req.json();
  const applicationId = body.applicationId as string | undefined;
  const candidateId = body.candidateId as string | undefined;
  const targetJobId = body.targetJobId as string | undefined;
  const baseResumeId = body.baseResumeId as string | undefined;
  const finalResumeVersionId = body.finalResumeVersionId as string | undefined;
  const approvedKeywordIds = body.approvedKeywordIds as string[] | undefined;
  const rejectedKeywordIds = body.rejectedKeywordIds as string[] | undefined;
  const coverLetter = body.coverLetter as string | undefined;
  const recruiterMessage = body.recruiterMessage as string | undefined;
  const hiringManagerEmail = body.hiringManagerEmail as string | undefined;
  const interviewPrepNotes = body.interviewPrepNotes as string | undefined;

  if (!applicationId) {
    return NextResponse.json({ error: "applicationId is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("application_packets")
    .insert({
      application_id: applicationId,
      base_resume_id: baseResumeId ?? null,
      target_job_id: targetJobId ?? null,
      final_resume_version_id: finalResumeVersionId ?? null,
      approved_keyword_ids: approvedKeywordIds ?? null,
      rejected_keyword_ids: rejectedKeywordIds ?? null,
      cover_letter: coverLetter ?? null,
      recruiter_message: recruiterMessage ?? null,
      hiring_manager_email: hiringManagerEmail ?? null,
      interview_prep_notes: interviewPrepNotes ?? null,
      created_by: context!.profile.user_id,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Application packet already exists for this application." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logActivity({
    userId: context!.profile.user_id,
    actorName: context!.profile.display_name || context!.profile.email || undefined,
    type: "create",
    description: `Created application packet for application ${applicationId}`,
    entityType: "application_packet",
    entityId: applicationId,
    metadata: { application_id: applicationId, candidate_id: candidateId, target_job_id: targetJobId },
  });

  return NextResponse.json(data, { status: 201 });
}
