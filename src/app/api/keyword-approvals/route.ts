// src/app/api/keyword-approvals/route.ts
// GET  -> list by candidateId query param, join with job_keywords(*)
// POST -> upsert keyword approval (delete existing for same keyword_id+candidate_id, then insert new)

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { isNeon } from "@/server/db";
import { query, queryOne, execute } from "@/server/db/neon";
import { logActivity } from "@/lib/activity";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const candidateId = new URL(req.url).searchParams.get("candidateId");
  if (!candidateId) return NextResponse.json({ error: "candidateId is required" }, { status: 400 });

  if (isNeon()) {
    const data = await query<any>(`
      SELECT ka.*, row_to_json(jk.*) as job_keywords
      FROM keyword_approvals ka
      LEFT JOIN job_keywords jk ON jk.id = ka.keyword_id
      WHERE ka.candidate_id = $1
      ORDER BY ka.decided_at DESC
    `, [candidateId]);
    return NextResponse.json(data ?? []);
  } else {
    const { supabase } = await import("@/lib/supabase");
    const { data, error } = await supabase
      .from("keyword_approvals")
      .select("*, job_keywords(*)")
      .eq("candidate_id", candidateId)
      .order("decided_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data ?? []);
  }
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const body = await req.json();
  const keywordId = body.keywordId as string | undefined;
  const candidateId = body.candidateId as string | undefined;
  const decision = body.decision as string | undefined;
  const baseResumeId = body.baseResumeId as string | undefined;
  const evidenceStatus = body.evidenceStatus as string | undefined;
  const evidenceIds = body.evidenceIds as string[] | undefined;
  const notes = body.notes as string | undefined;

  if (!keywordId || !candidateId || !decision) {
    return NextResponse.json({ error: "keywordId, candidateId, and decision are required" }, { status: 400 });
  }

  const validDecisions = ["approved", "rejected", "needs_review", "cover_letter_only", "already_present"];
  if (!validDecisions.includes(decision)) {
    return NextResponse.json({ error: `decision must be one of: ${validDecisions.join(", ")}` }, { status: 400 });
  }

  if (isNeon()) {
    await execute(`DELETE FROM keyword_approvals WHERE keyword_id = $1 AND candidate_id = $2`, [keywordId, candidateId]);
    const data = await queryOne<any>(`INSERT INTO keyword_approvals (keyword_id, candidate_id, base_resume_id, decision, evidence_status, evidence_ids, notes, decided_by, decided_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`, [
      keywordId,
      candidateId,
      baseResumeId ?? null,
      decision,
      evidenceStatus ?? null,
      evidenceIds ?? null,
      notes ?? null,
      context!.profile.user_id,
      new Date().toISOString(),
    ]);

    await logActivity({
      userId: context!.profile.user_id,
      actorName: context!.profile.display_name || context!.profile.email || undefined,
      type: "create",
      description: `Recorded keyword approval (${decision}) for candidate ${candidateId}`,
      entityType: "keyword_approval",
      entityId: data.id,
      metadata: { keyword_id: keywordId, candidate_id: candidateId, decision },
    });

    return NextResponse.json(data, { status: 201 });
  } else {
    const { supabase } = await import("@/lib/supabase");
    await supabase
      .from("keyword_approvals")
      .delete()
      .eq("keyword_id", keywordId)
      .eq("candidate_id", candidateId);

    const { data, error } = await supabase
      .from("keyword_approvals")
      .insert({
        keyword_id: keywordId,
        candidate_id: candidateId,
        base_resume_id: baseResumeId ?? null,
        decision,
        evidence_status: evidenceStatus ?? null,
        evidence_ids: evidenceIds ?? null,
        notes: notes ?? null,
        decided_by: context!.profile.user_id,
        decided_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await logActivity({
      userId: context!.profile.user_id,
      actorName: context!.profile.display_name || context!.profile.email || undefined,
      type: "create",
      description: `Recorded keyword approval (${decision}) for candidate ${candidateId}`,
      entityType: "keyword_approval",
      entityId: data.id,
      metadata: { keyword_id: keywordId, candidate_id: candidateId, decision },
    });

    return NextResponse.json(data, { status: 201 });
  }
}
