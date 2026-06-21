// src/app/api/application-packets/route.ts
// GET  -> list by candidateId query param
// POST -> create application packet

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { isNeon } from "@/server/db";
import { query, queryOne } from "@/server/db/neon";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const candidateId = new URL(req.url).searchParams.get("candidateId");
  if (!candidateId) return NextResponse.json({ error: "candidateId is required" }, { status: 400 });

  let applicationIds: string[];

  if (isNeon()) {
    const applications = await query<any>(
      `SELECT id FROM applications WHERE candidate_id = $1`,
      [candidateId]
    );
    applicationIds = (applications ?? []).map((a: any) => a.id as string);
    if (applicationIds.length === 0) return NextResponse.json([]);

  const packets = await query<any>(
      `SELECT ap.*, a.status as application_status, a.review_status as application_review_status, a.review_note as application_review_note, j.title as job_title, j.company as job_company FROM application_packets ap LEFT JOIN applications a ON a.id = ap.application_id LEFT JOIN jobs j ON j.id = a.job_id WHERE ap.application_id::text = ANY($1) ORDER BY ap.created_at DESC`,
      [applicationIds]
    );

    const mapped = (packets ?? []).map((row: any) => {
      const { application_status, application_review_status, application_review_note, job_title, job_company, ...rest } = row;
      return {
        ...rest,
        applications: {
          status: application_status,
          review_status: application_review_status,
          review_note: application_review_note,
          jobs: {
            title: job_title,
            company: job_company,
          },
        },
      };
    });
    return NextResponse.json(mapped);
  } else {
    const { supabase } = await import("@/lib/supabase");
    const { data: applications } = await supabase
      .from("applications")
      .select("id")
      .eq("candidate_id", candidateId);

    applicationIds = (applications ?? []).map((a: any) => a.id as string);
    if (applicationIds.length === 0) return NextResponse.json([]);

    const { data, error } = await supabase
      .from("application_packets")
      .select("*, applications(status, review_status, review_note, jobs(title, company))")
      .in("application_id", applicationIds)
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data ?? []);
  }
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

  let data: any;
  let error: any;

  if (isNeon()) {
    try {
      data = await queryOne(
        `INSERT INTO application_packets (application_id, base_resume_id, target_job_id, final_resume_version_id, approved_keyword_ids, rejected_keyword_ids, cover_letter, recruiter_message, hiring_manager_email, interview_prep_notes, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [applicationId, baseResumeId ?? null, targetJobId ?? null, finalResumeVersionId ?? null, approvedKeywordIds ?? null, rejectedKeywordIds ?? null, coverLetter ?? null, recruiterMessage ?? null, hiringManagerEmail ?? null, interviewPrepNotes ?? null, context!.profile.user_id]
      );
      error = null;
    } catch (e: any) {
      error = e;
    }
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
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
    data = res.data;
    error = res.error;
  }

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
