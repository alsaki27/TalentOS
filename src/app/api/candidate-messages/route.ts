// src/app/api/candidate-messages/route.ts
// GET  -> get messages for a candidate
// POST -> send message to candidate

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { isNeon } from "@/server/db";
import { query, queryOne, execute } from "@/server/db/neon";
import { sendEmail } from "@/lib/emailService";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const candidateId = url.searchParams.get("candidateId") || "";
  if (!candidateId) return NextResponse.json({ error: "candidateId is required" }, { status: 400 });

  if (isNeon()) {
    const data = await query<Record<string, any>>(
      `SELECT cm.*,
        jsonb_build_object('id', c.id, 'name', c.name, 'avatar_url', c.avatar_url) as candidates
       FROM candidate_messages cm
       LEFT JOIN candidates c ON cm.candidate_id = c.id
       WHERE cm.candidate_id = $1
       ORDER BY cm.created_at ASC`,
      [candidateId]
    );
    return NextResponse.json({ messages: data ?? [] });
  } else {
    const { supabase } = await import("@/lib/supabase");
    const { data, error } = await supabase
      .from("candidate_messages")
      .select("*, candidates(id,name,avatar_url)")
      .eq("candidate_id", candidateId)
      .order("created_at", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ messages: data ?? [] });
  }
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const body = await req.json();
  if (!body.candidate_id || !body.body) {
    return NextResponse.json({ error: "candidate_id and body are required" }, { status: 400 });
  }

  let candidate;
  if (isNeon()) {
    candidate = await queryOne<{ id: string; name: string; email: string | null }>(
      'SELECT id, name, email FROM candidates WHERE id = $1',
      [body.candidate_id]
    );
  } else {
    const { supabase } = await import("@/lib/supabase");
    const { data } = await supabase
      .from("candidates")
      .select("id, name, email")
      .eq("id", body.candidate_id)
      .maybeSingle();
    candidate = data;
  }

  if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

  const channel = body.channel ?? "in_app";

  if (channel === "email" && !candidate.email) {
    return NextResponse.json({ error: "Candidate has no email address" }, { status: 400 });
  }

  if (channel === "email" && candidate.email) {
    const emailResult = await sendEmail({
      to: candidate.email,
      subject: body.subject ?? "Message from Skarion Tracker",
      body: body.body,
      candidateId: body.candidate_id,
      sentBy: context.profile.user_id,
    });

    if (!emailResult.success) {
      return NextResponse.json({ error: emailResult.error ?? "Failed to send email" }, { status: 500 });
    }
  }

  let data;
  if (isNeon()) {
    data = await queryOne<Record<string, any>>(
      `INSERT INTO candidate_messages (candidate_id, direction, channel, subject, body, sender_id, sender_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        body.candidate_id,
        "outbound",
        channel,
        body.subject ?? null,
        body.body,
        context.profile.user_id,
        context.profile.display_name || context.profile.email,
      ]
    );
  } else {
    const { supabase } = await import("@/lib/supabase");
    const { data: d, error } = await supabase
      .from("candidate_messages")
      .insert({
        candidate_id: body.candidate_id,
        direction: "outbound",
        channel,
        subject: body.subject ?? null,
        body: body.body,
        sender_id: context.profile.user_id,
        sender_name: context.profile.display_name || context.profile.email,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    data = d;
  }

  await logActivity({
    userId: context.profile.user_id,
    actorName: context.profile.display_name || context.profile.email || undefined,
    type: "message",
    description: `Sent ${channel} message to candidate ${candidate.name}`,
    entityType: "candidate",
    entityId: body.candidate_id,
    entityName: candidate.name,
  });

  return NextResponse.json(data, { status: 201 });
}
