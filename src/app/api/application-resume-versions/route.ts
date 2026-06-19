// src/app/api/application-resume-versions/route.ts
// GET  -> list by candidateId query param
// POST -> create from baseResumeId + targetJobId. Copy or save tailored content, set status='draft', created_by

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
    .select("id, candidate_id, base_resume_id, source_resume_id, target_job_id, title, version_label, generated_text, status, ats_score, truth_score, one_page_fit_score, created_by, created_at, updated_at, target_jobs(job_id, jobs(title, company))")
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
  const title = (body.title as string | undefined)?.trim();
  const versionLabel = (body.versionLabel as string | undefined)?.trim();
  const generatedText = (body.generatedText as string | undefined)?.trim();
  const content = body.content;

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

  const resolvedContent = generatedText
    ? {
        ...(content ?? baseResume.content),
        customSections: [
          ...((content ?? baseResume.content)?.customSections ?? []),
          {
            id: `tailored-markdown-${Date.now()}`,
            title: "Tailored Markdown Draft",
            bullets: generatedText.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => ({
              id: `tailored-line-${index}`,
              text: line,
              riskLevel: "low",
            })),
          },
        ],
      }
    : (content ?? baseResume.content);

  const { data, error } = await supabase
    .from("application_resume_versions")
    .insert({
      candidate_id: baseResume.candidate_id,
      base_resume_id: baseResumeId,
      source_resume_id: baseResumeId,
      target_job_id: targetJobId,
      title: title || null,
      version_label: versionLabel || null,
      generated_text: generatedText || null,
      content: resolvedContent,
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
    description: generatedText ? `Created tailored resume variant "${title || versionLabel || data.id}"` : `Created application resume version from base resume ${baseResumeId}`,
    entityType: "application_resume_version",
    entityId: data.id,
    entityName: title || versionLabel || undefined,
    metadata: { base_resume_id: baseResumeId, source_resume_id: baseResumeId, target_job_id: targetJobId, candidate_id: baseResume.candidate_id, generated: Boolean(generatedText) },
  });

  return NextResponse.json(data, { status: 201 });
}
