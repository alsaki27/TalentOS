// src/app/api/email-sequences/[id]/trigger/route.ts
// POST -> manually trigger a sequence for a candidate

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { queryOne, execute } from "@/server/db/neon";
import { findCandidateById } from "@/server/repositories/candidatesRepository";
import { triggerSequence } from "@/lib/emailService";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const body = await req.json();
  if (!body.candidate_id) return NextResponse.json({ error: "candidate_id is required" }, { status: 400 });

  let candidate;
  if (isNeon()) {
    candidate = await findCandidateById(body.candidate_id);
  } else {
    const { data } = await supabase
      .from("candidates")
      .select("id, name, email")
      .eq("id", body.candidate_id)
      .maybeSingle();
    candidate = data as { id: string; name: string | null; email: string | null } | null;
  }

  if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

  const mergeData: Record<string, string> = {
    candidate_name: candidate.name || "Candidate",
    ...body.merge_data,
  };

  const result = await triggerSequence(body.candidate_id, params.id, body.trigger_event ?? "manual", mergeData);

  if (!result.success) {
    return NextResponse.json({ error: result.error ?? "Trigger failed" }, { status: 500 });
  }

  if (isNeon()) {
    await execute(
      "INSERT INTO activity_logs (user_id, actor_name, type, description, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5, $6)",
      [context.profile.user_id, context.profile.display_name || context.profile.email, "trigger", `Triggered sequence ${params.id} for candidate ${candidate.name}`, "email_sequence", params.id]
    );
  } else {
    await supabase.from("activity_logs").insert({
      user_id: context.profile.user_id,
      actor_name: context.profile.display_name || context.profile.email,
      type: "trigger",
      description: `Triggered sequence ${params.id} for candidate ${candidate.name}`,
      entity_type: "email_sequence",
      entity_id: params.id,
    });
  }

  return NextResponse.json({ success: true });
}
