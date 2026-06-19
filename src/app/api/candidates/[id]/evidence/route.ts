// src/app/api/candidates/[id]/evidence/route.ts
// GET  -> list evidence for a candidate
// POST -> create evidence entry

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext, MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { supabase } from "@/lib/supabase";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { data, error } = await supabase
    .from("candidate_evidence")
    .select("*, profiles:created_by(display_name)")
    .eq("candidate_id", params.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();

  if (!body.title || !body.source_type) {
    return NextResponse.json({ error: "title and source_type are required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("candidate_evidence")
    .insert({
      candidate_id: params.id,
      source_type: body.source_type,
      title: body.title,
      description: body.description ?? null,
      related_skills: body.related_skills ?? [],
      proof_url: body.proof_url ?? null,
      confidence_score: body.confidence_score ?? 0.7,
      created_by: context!.profile.user_id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

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
