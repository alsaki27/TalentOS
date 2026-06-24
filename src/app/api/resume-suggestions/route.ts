// src/app/api/resume-suggestions/route.ts
// GET  -> list by applicationResumeId query param
// POST -> create a suggestion (from AI or manual)

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { isNeon } from "@/server/db";
import { query, queryOne } from "@/server/db/neon";
import { logActivity } from "@/lib/activity";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const applicationResumeId = new URL(req.url).searchParams.get("applicationResumeId");
  if (!applicationResumeId) {
    return NextResponse.json({ error: "applicationResumeId is required" }, { status: 400 });
  }

  let data: any;
  let error: any;

  if (isNeon()) {
    data = await query(
      `SELECT * FROM resume_suggestions WHERE application_resume_id = $1 ORDER BY created_at DESC`,
      [applicationResumeId]
    );
    error = null;
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("resume_suggestions")
      .select("*")
      .eq("application_resume_id", applicationResumeId)
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

  let data: any;
  let error: any;

  if (isNeon()) {
    data = await queryOne(
      `INSERT INTO resume_suggestions (application_resume_id, section_type, target_block_id, original_text, suggested_text, reason, jd_keyword_ids, evidence_ids, confidence_score, truth_risk, ats_impact, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [applicationResumeId, sectionType ?? null, targetBlockId ?? null, originalText, suggestedText, reason ?? null, jdKeywordIds ?? null, evidenceIds ?? null, confidenceScore ?? null, truthRisk ?? null, atsImpact ?? null, createdBy]
    );
    error = data ? null : { message: "Insert failed" };
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
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
    data = res.data;
    error = res.error;
  }

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
