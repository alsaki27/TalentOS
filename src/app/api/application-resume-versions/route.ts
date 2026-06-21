// src/app/api/application-resume-versions/route.ts
// GET  -> list by candidateId query param
// POST -> create from baseResumeId + targetJobId. Copy or save tailored content, set status='draft', created_by

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

  let data: any;
  let error: any;

  if (isNeon()) {
    const rows = await query(
      `SELECT arv.id, arv.candidate_id, arv.base_resume_id, arv.source_resume_id, arv.target_job_id, arv.title, arv.version_label, arv.generated_text, arv.status, arv.source_type, arv.ats_score, arv.truth_score, arv.one_page_fit_score, arv.created_by, arv.created_at, arv.updated_at, tj.job_id as target_job_job_id, j.title as job_title, j.company as job_company FROM application_resume_versions arv LEFT JOIN target_jobs tj ON tj.id = arv.target_job_id LEFT JOIN jobs j ON j.id = tj.job_id WHERE arv.candidate_id = $1 ORDER BY arv.created_at DESC`,
      [candidateId]
    );
    data = (rows ?? []).map((row: any) => {
      const { target_job_job_id, job_title, job_company, ...rest } = row;
      return {
        ...rest,
        target_jobs: {
          job_id: target_job_job_id,
          jobs: {
            title: job_title,
            company: job_company,
          },
        },
      };
    });
    error = null;
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("application_resume_versions")
      .select("id, candidate_id, base_resume_id, source_resume_id, target_job_id, title, version_label, generated_text, status, source_type, ats_score, truth_score, one_page_fit_score, created_by, created_at, updated_at, target_jobs(job_id, jobs(title, company))")
      .eq("candidate_id", candidateId)
      .order("created_at", { ascending: false });
    data = res.data;
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const body = await req.json();
  const baseResumeId = body.baseResumeId as string | undefined;
  const targetJobId = body.targetJobId as string | undefined;
  const candidateId = body.candidateId as string | undefined;
  const sourceType = (body.sourceType as string | undefined) ?? "base_resume";
  const title = (body.title as string | undefined)?.trim();
  const versionLabel = (body.versionLabel as string | undefined)?.trim();
  const generatedText = (body.generatedText as string | undefined)?.trim();
  const content = body.content;

  if (!targetJobId) {
    return NextResponse.json({ error: "targetJobId is required" }, { status: 400 });
  }

  let insertData: Record<string, unknown> = {
    target_job_id: targetJobId,
    status: "draft",
    source_type: sourceType,
    created_by: context!.profile.user_id,
  };

  if (baseResumeId) {
    // Base resume path: copy content from base_resume
    let baseResume: any;
    let baseError: any;

    if (isNeon()) {
      baseResume = await queryOne(
        `SELECT content, candidate_id FROM base_resumes WHERE id = $1`,
        [baseResumeId]
      );
      baseError = baseResume ? null : { message: "Base resume not found" };
    } else {
      const { supabase } = await import("@/lib/supabase");
      const res = await supabase
        .from("base_resumes")
        .select("content, candidate_id")
        .eq("id", baseResumeId)
        .single();
      baseResume = res.data;
      baseError = res.error;
    }

    if (baseError || !baseResume) {
      return NextResponse.json({ error: "Base resume not found" }, { status: 404 });
    }

    insertData.candidate_id = baseResume.candidate_id;
    insertData.base_resume_id = baseResumeId;
    insertData.content = baseResume.content;
  } else {
    // Blank or original resume path: require candidateId and optionally content
    if (!candidateId) {
      return NextResponse.json({ error: "candidateId is required when baseResumeId is not provided" }, { status: 400 });
    }
    insertData.candidate_id = candidateId;
    insertData.base_resume_id = null;
    insertData.content = body.content ?? {
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

  const resolvedContent = generatedText
    ? {
        ...(content ?? insertData.content),
        customSections: [
          ...((content ?? insertData.content)?.customSections ?? []),
          {
            id: `tailored-markdown-${Date.now()}`,
            title: "Tailored Markdown Draft",
            bullets: generatedText.split(/\r?\n/).filter((line: string) => line.trim()).map((line: string, index: number) => ({
              id: `tailored-line-${index}`,
              text: line,
              riskLevel: "low",
            })),
          },
        ],
      }
    : (content ?? insertData.content);

  insertData.title = title || null;
  insertData.version_label = versionLabel || null;
  insertData.generated_text = generatedText || null;
  insertData.source_resume_id = baseResumeId ?? null;
  insertData.content = resolvedContent;

  let data: any;
  let error: any;

  if (isNeon()) {
    data = await queryOne(
      `INSERT INTO application_resume_versions (target_job_id, status, source_type, created_by, candidate_id, base_resume_id, content, title, version_label, generated_text, source_resume_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [targetJobId, "draft", sourceType, context!.profile.user_id, insertData.candidate_id, insertData.base_resume_id, resolvedContent, title || null, versionLabel || null, generatedText || null, baseResumeId ?? null]
    );
    error = data ? null : { message: "Insert failed" };
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("application_resume_versions")
      .insert(insertData)
      .select()
      .single();
    data = res.data;
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logActivity({
    userId: context!.profile.user_id,
    actorName: context!.profile.display_name || context!.profile.email || undefined,
    type: "create",
    description: generatedText ? `Created tailored resume variant "${title || versionLabel || data.id}"` : `Created application resume version (source: ${sourceType})`,
    entityType: "application_resume_version",
    entityId: data.id,
    entityName: title || versionLabel || undefined,
    metadata: { base_resume_id: baseResumeId ?? null, source_resume_id: baseResumeId ?? null, target_job_id: targetJobId, candidate_id: insertData.candidate_id, source_type: sourceType, generated: Boolean(generatedText) },
  });

  return NextResponse.json(data, { status: 201 });
}
