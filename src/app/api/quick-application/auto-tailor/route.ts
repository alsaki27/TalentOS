// src/app/api/quick-application/auto-tailor/route.ts
// Auto-starts the 4-stage multi-agent application workflow (Job Lens → Resume
// Forge → Hiring Panel → Final Polish) whenever an application is logged from a
// base resume. Replaces the older one-shot ATS tailor that produced a
// /falood/studio/tailor/{id} record; the workflow finalizes into a
// studio-native application_resume_versions row at /falood/studio/application/{id}
// with the ATS score surfaced in the studio header.
//
// This route is fire-and-forget from the UI's perspective: it ensures the
// target_job + base-resume inputs exist, starts the workflow, kicks off the
// first stage, and returns 202 with the workflowId so the modal can redirect to
// the application queue (which renders live stage progress, the ATS score, and
// the "Open in Studio" link once the workflow completes).
//
// Idempotent: if an active workflow already exists for the application, returns
// the existing workflowId instead of starting a duplicate.

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { isNeon } from "@/server/db";
import { queryOne, query } from "@/server/db/neon";
import { findJobById } from "@/server/repositories/jobsRepository";
import { findActiveWorkflowByApplicationId } from "@/server/repositories/applicationAiWorkflowRepository";
import { upsertTargetJobByCandidateAndJob } from "@/server/repositories/targetJobsRepository";
import { startWorkflow, dispatchWorkflowById } from "@/server/services/applicationAiWorkflowService";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function formatJobDescription(job: any): string {
  return [
    `Title: ${job.title ?? ""}`,
    job.company ? `Company: ${job.company}` : null,
    job.location ? `Location: ${job.location}` : null,
    job.job_category ? `Category: ${job.job_category}` : null,
    job.raw_description ? job.raw_description : null,
    job.notes ? `Internal notes: ${job.notes}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const body = await req.json();
  const candidateId = body.candidateId as string | undefined;
  const jobId = body.jobId as string | undefined;
  const applicationId = body.applicationId as string | undefined;
  const baseResumeId = body.baseResumeId as string | undefined;

  if (!candidateId || !jobId || !applicationId || !baseResumeId) {
    return NextResponse.json(
      { error: "candidateId, jobId, applicationId, and baseResumeId are required." },
      { status: 400 }
    );
  }

  /* ── 0. Idempotency: don't start a duplicate workflow for this application ── */
  const existing = await findActiveWorkflowByApplicationId(applicationId);
  if (existing) {
    return NextResponse.json(
      { workflowId: existing.id, status: existing.status, message: "Active workflow already exists" },
      { status: 200 }
    );
  }

  /* ── 1. Fetch base resume (content is stored in the studio's ResumeDocument shape) ── */
  let baseResume: any;
  if (isNeon()) {
    baseResume = await queryOne<any>(
      "SELECT id, name, content FROM base_resumes WHERE id = $1 AND candidate_id = $2",
      [baseResumeId, candidateId]
    );
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("base_resumes")
      .select("id, name, content")
      .eq("id", baseResumeId)
      .eq("candidate_id", candidateId)
      .single();
    baseResume = res.data;
  }

  if (!baseResume?.content) {
    return NextResponse.json({ error: "Base resume not found or has no content." }, { status: 404 });
  }

  const job = await findJobById(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  /* ── 2. Ensure a target_jobs row exists for this candidate+job.
   *     Finalization resolves the resume version's target_job via
   *     (candidate_id, job_id) and has UNIQUE(candidate_id, job_id); create it
   *     up-front from the masterlist job so finalization never fails on a
   *     missing target_job right after an application is logged. */
  const rawDescription = job.raw_description || formatJobDescription(job) || "";
  const targetJob = await upsertTargetJobByCandidateAndJob(candidateId, jobId, {
    raw_description: rawDescription || "",
    parsed_description: null,
  });
  const targetJobId = (targetJob as any)?.id ?? (
    await queryOne<{ id: string }>(
      "SELECT id FROM target_jobs WHERE candidate_id = $1 AND job_id = $2 LIMIT 1",
      [candidateId, jobId]
    )
  )?.id;
  if (!targetJobId) {
    return NextResponse.json({ error: "Failed to ensure target job for candidate." }, { status: 500 });
  }

  /* ── 3. Load candidate evidence (consumed by the Resume Forge agent) ── */
  const evidence = await query(
    "SELECT * FROM candidate_evidence WHERE candidate_id = $1 ORDER BY created_at DESC LIMIT 50",
    [candidateId]
  );

  /* ── 4. Start the multi-agent workflow + dispatch stage 0 ── */
  const { workflowId } = await startWorkflow({
    applicationId,
    candidateId,
    job,
    baseResume,
    evidence: evidence ?? [],
    startedBy: context?.profile.user_id,
  });

  dispatchWorkflowById(workflowId).catch((err) => {
    console.error(`[QuickApplication auto-tailor] Initial dispatch failed for workflow ${workflowId}:`, err);
  });

  return NextResponse.json(
    { workflowId, status: "queued", message: "Multi-agent resume workflow started" },
    { status: 202 }
  );
}