// src/app/api/candidates/[id]/evidence/route.ts
// GET  -> list evidence for a candidate
// POST -> create evidence entry

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext, MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { query, queryOne } from "@/server/db/neon";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const data = await query<Record<string, any>>(
    `SELECT ce.*,
      jsonb_build_object('display_name', p.display_name) as profiles
     FROM candidate_evidence ce
     LEFT JOIN profiles p ON ce.created_by = p.user_id
     WHERE ce.candidate_id = $1
     ORDER BY ce.created_at DESC`,
    [params.id]
  );
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();

  if (!body.title || !body.source_type) {
    return NextResponse.json({ error: "title and source_type are required" }, { status: 400 });
  }

  const data = await queryOne<Record<string, any>>(
    `INSERT INTO candidate_evidence (candidate_id, source_type, title, description, related_skills, proof_url, confidence_score, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      params.id,
      body.source_type,
      body.title,
      body.description ?? null,
      body.related_skills ?? [],
      body.proof_url ?? null,
      body.confidence_score ?? 0.7,
      context!.profile.user_id,
    ]
  );
  if (!data) return NextResponse.json({ error: "Failed to create evidence." }, { status: 500 });

  await logActivity({
    userId: context!.profile.user_id,
    actorName: context!.profile.display_name || context!.profile.email || undefined,
    type: "create",
    description: `Added evidence "${body.title}" for candidate ${params.id}`,
    entityType: "candidate_evidence",
    entityId: data.id,
    entityName: body.title,
    metadata: { candidate_id: params.id, source_type: body.source_type },
  });

  return NextResponse.json(data, { status: 201 });
}
