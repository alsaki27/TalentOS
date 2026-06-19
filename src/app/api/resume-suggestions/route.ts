// src/app/api/resume-suggestions/route.ts
// GET  -> list by applicationResumeId query param
// POST -> create a suggestion (from AI or manual)

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { logActivity } from "@/lib/activity";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const applicationResumeId = new URL(req.url).searchParams.get("applicationResumeId");
  if (!applicationResumeId) {
    return NextResponse.json({ error: "applicationResumeId is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("resume_suggestions")
    .select("*")
    .eq("application_resume_id", applicationResumeId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const body = await req.json();
  const applicationResumeId = body.applicationResumeId as string | undefined;
  const sectionType = body.sectionType as string | undefined;
  const targetBlockId = body.targetBlockId as string | undefined;
  const originalText = body.originalText as string | undefined;
  const suggestedText = body.suggestedText as string | undefined;
  const reason = body.reason as string | undefined;
  const jdKeywordIds = body.jdKeywordIds as string[] | undefined;
  const evidenceIds = body.evidenceIds as string[] | undefined;
  const confidenceScore = body.confidenceScore as number | undefined;
  const truthRisk = body.truthRisk as string | undefined;
  const atsImpact = body.atsImpact as string | undefined;
  const createdBy = (body.createdBy as "ai" | "user") ?? "ai";

  if (!applicationResumeId || !originalText || !suggestedText) {
    return NextResponse.json({ error: "applicationResumeId, originalText, and suggestedText are required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("resume_suggestions")
    .insert({
      application_resume_id: applicationResumeId,
      section_type: sectionType ?? null,
      target_block_id: targetBlockId ?? null,
      original_text: originalText,
      suggested_text: suggestedText,
      reason: reason ?? null,
      jd_keyword_ids: jdKeywordIds ?? null,
      evidence_ids: evidenceIds ?? null,
      confidence_score: confidenceScore ?? null,
      truth_risk: truthRisk ?? null,
      ats_impact: atsImpact ?? null,
      created_by: createdBy,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logActivity({
    userId: context!.profile.user_id,
    actorName: context!.profile.display_name || context!.profile.email || undefined,
    type: "create",
    description: `Created resume suggestion for application resume ${applicationResumeId}`,
    entityType: "resume_suggestion",
    entityId: data.id,
    metadata: { application_resume_id: applicationResumeId, section_type: sectionType, created_by: createdBy },
  });

  return NextResponse.json(data, { status: 201 });
}
