// src/app/api/candidate-messages/route.ts
// GET  -> get messages for a candidate
// POST -> send message to candidate

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { sendEmail } from "@/lib/emailService";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const candidateId = url.searchParams.get("candidateId") || "";
  if (!candidateId) return NextResponse.json({ error: "candidateId is required" }, { status: 400 });

  const { data, error } = await supabase
    .from("candidate_messages")
    .select("*, candidates(id,name,avatar_url)")
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ messages: data ?? [] });
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const body = await req.json();
  if (!body.candidate_id || !body.body) {
    return NextResponse.json({ error: "candidate_id and body are required" }, { status: 400 });
  }

  const { data: candidate } = await supabase
    .from("candidates")
    .select("id, name, email")
    .eq("id", body.candidate_id)
    .maybeSingle();

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

  const { data, error } = await supabase
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

  await logActivity({
    userId: context.profile.user_id,
    actorName: context.profile.display_name || context.profile.email,
    type: "message",
    description: `Sent ${channel} message to candidate ${candidate.name}`,
    entityType: "candidate",
    entityId: body.candidate_id,
    entityName: candidate.name,
  });

  return NextResponse.json(data, { status: 201 });
}
