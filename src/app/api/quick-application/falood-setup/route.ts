// src/app/api/quick-application/falood-setup/route.ts
// One-shot setup for Falood AI after an application is created.
// Creates (or reuses) a target_job for the candidate+job pair,
// then creates an application_resume_version (from base resume or blank).
// Optionally creates an application_packet if applicationId is provided.
// Returns { versionId, targetJobId, packetId? } so the caller can
// redirect straight to /falood/studio/application/{versionId}.

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { isNeon } from "@/server/db";
import { query, queryOne } from "@/server/db/neon";
import { findJobById } from "@/server/repositories/jobsRepository";
import { upsertTargetJobByCandidateAndJob } from "@/server/repositories/targetJobsRepository";
import { logActivity } from "@/lib/activity";

function jobDescription(job: any): string {
  return [
    `Title: ${job.title ?? ""}`,
    job.company ? `Company: ${job.company}` : null,
    job.location ? `Location: ${job.location}` : null,
    job.job_category ? `Category: ${job.job_category}` : null,
    job.description_text ? job.description_text : null,
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
  const sourceType = (body.sourceType as string | undefined) ?? "blank";

  if (!candidateId || !jobId) {
    return NextResponse.json(
      { error: "candidateId and jobId are required." },
      { status: 400 }
    );
  }

  /* ── 1. Fetch job so we can build the raw description ── */
  const job = await findJobById(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  /* ── 2. Upsert target_job for this candidate+job pair ── */
  const rawDescription = jobDescription(job);
  const targetJob = await upsertTargetJobByCandidateAndJob(
    candidateId,
    jobId,
    {
      raw_description: rawDescription,
      created_by: context!.profile.user_id,
    }
  );

  if (!targetJob) {
    return NextResponse.json(
      { error: "Could not prepare target job for Falood AI." },
      { status: 500 }
    );
  }

  const targetJobId = targetJob.id as string;

  /* ── 3. Build insert payload for application_resume_version ── */
  let insertData: Record<string, unknown> = {
    target_job_id: targetJobId,
    status: "draft",
    source_type: sourceType,
    created_by: context!.profile.user_id,
    candidate_id: candidateId,
  };

  if (baseResumeId) {
    /* Copy from base resume */
    let baseResume: any;
    if (isNeon()) {
      baseResume = await queryOne(
        `SELECT content, candidate_id FROM base_resumes WHERE id = $1`,
        [baseResumeId]
      );
    } else {
      const { supabase } = await import("@/lib/supabase");
      const res = await supabase
        .from("base_resumes")
        .select("content, candidate_id")
        .eq("id", baseResumeId)
        .single();
      baseResume = res.data;
    }

    if (!baseResume) {
      return NextResponse.json(
        { error: "Base resume not found." },
        { status: 404 }
      );
    }

    insertData.candidate_id = baseResume.candidate_id;
    insertData.base_resume_id = baseResumeId;
    insertData.content = baseResume.content;
    insertData.source_resume_id = baseResumeId;
  } else {
    /* Blank canvas */
    insertData.base_resume_id = null;
    insertData.source_resume_id = null;
    insertData.content = {
      header: { fullName: "" },
      skills: [],
      experience: [],
      education: [],
      formatting: {
        styleId: "skarion_compact_professional",
        pageFormat: "letter",
        fontFamily: "Calibri",
        fontSize: 10.5,
        marginTop: 0.5,
        marginRight: 0.5,
        marginBottom: 0.5,
        marginLeft: 0.5,
        sectionSpacing: 8,
        bulletSpacing: 2,
        lineHeight: 1.15,
      },
    };
  }

  /* ── 4. Insert application_resume_version ── */
  let version: any;
  if (isNeon()) {
    const contentJson = JSON.stringify(insertData.content);
    version = await queryOne(
      `INSERT INTO application_resume_versions
        (candidate_id, base_resume_id, target_job_id, content, status, source_type, created_by, source_resume_id)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
       RETURNING *`,
      [
        insertData.candidate_id,
        insertData.base_resume_id,
        insertData.target_job_id,
        contentJson,
        insertData.status,
        insertData.source_type,
        insertData.created_by,
        insertData.source_resume_id,
      ]
    );
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("application_resume_versions")
      .insert({
        candidate_id: insertData.candidate_id,
        base_resume_id: insertData.base_resume_id,
        target_job_id: insertData.target_job_id,
        content: insertData.content,
        status: insertData.status,
        source_type: insertData.source_type,
        created_by: insertData.created_by,
        source_resume_id: insertData.source_resume_id,
      })
      .select()
      .single();
    version = res.data;
    if (res.error) {
      return NextResponse.json(
        { error: res.error.message },
        { status: 500 }
      );
    }
  }

  if (!version) {
    return NextResponse.json(
      { error: "Failed to create application resume version." },
      { status: 500 }
    );
  }

  /* ── 5. Optionally create application_packet linking version to application ── */
  let packetId: string | null = null;
  if (applicationId) {
    try {
      if (isNeon()) {
        const packet = await queryOne(
          `INSERT INTO application_packets
            (application_id, base_resume_id, target_job_id, final_resume_version_id, created_by)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [
            applicationId,
            insertData.base_resume_id ?? null,
            targetJobId,
            version.id,
            context!.profile.user_id,
          ]
        );
        packetId = packet?.id ?? null;
      } else {
        const { supabase } = await import("@/lib/supabase");
        const res = await supabase
          .from("application_packets")
          .insert({
            application_id: applicationId,
            base_resume_id: insertData.base_resume_id ?? null,
            target_job_id: targetJobId,
            final_resume_version_id: version.id,
            created_by: context!.profile.user_id,
          })
          .select()
          .single();
        if (res.data) packetId = res.data.id;
      }
    } catch (e: any) {
      // 23505 = duplicate packet; ignore since we just want the version created
      if (e?.code !== "23505") {
        console.error("Failed to create application packet:", e);
      }
    }
  }

  await logActivity({
    userId: context!.profile.user_id,
    actorName: context!.profile.display_name || context!.profile.email || undefined,
    type: "create",
    description: `Falood setup: created resume version for application`,
    entityType: "application_resume_version",
    entityId: version.id,
    entityName: version.title || undefined,
    metadata: {
      candidate_id: candidateId,
      job_id: jobId,
      application_id: applicationId,
      base_resume_id: baseResumeId,
      target_job_id: targetJobId,
      packet_id: packetId,
    },
  });

  return NextResponse.json({
    versionId: version.id,
    targetJobId,
    packetId,
  });
}
