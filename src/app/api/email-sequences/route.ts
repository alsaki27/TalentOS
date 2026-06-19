// src/app/api/email-sequences/route.ts
// GET  -> list sequences
// POST -> create sequence with steps
// PATCH -> update sequence
// DELETE -> delete sequence

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10) || 50));
  const search = (url.searchParams.get("search") || "").trim().replace(/[,()]/g, "");

  let query = supabase.from("email_sequences").select("*, steps:email_sequence_steps(*, template:email_templates(id,name,subject))", { count: "exact" }).order("created_at", { ascending: false });

  if (search) query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);

  const from = (page - 1) * pageSize;
  const { data, error, count } = await query.range(from, from + pageSize - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [], total: count ?? 0, page, pageSize });
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const body = await req.json();
  if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const { data: sequence, error: seqError } = await supabase
    .from("email_sequences")
    .insert({
      name: body.name,
      description: body.description ?? null,
      trigger_event: body.trigger_event ?? null,
      is_active: body.is_active ?? true,
      created_by: context.profile.user_id,
    })
    .select()
    .single();

  if (seqError) return NextResponse.json({ error: seqError.message }, { status: 500 });

  const steps = body.steps ?? [];
  if (steps.length > 0) {
    const { error: stepError } = await supabase.from("email_sequence_steps").insert(
      steps.map((step: any) => ({
        sequence_id: sequence.id,
        step_number: step.step_number,
        template_id: step.template_id,
        delay_hours: step.delay_hours ?? 24,
        send_time: step.send_time ?? null,
        condition: step.condition ?? null,
      }))
    );
    if (stepError) return NextResponse.json({ error: stepError.message }, { status: 500 });
  }

  return NextResponse.json({ ...sequence, steps }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const body = await req.json();
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { data, error } = await supabase
    .from("email_sequences")
    .update({
      name: body.name ?? undefined,
      description: body.description ?? undefined,
      trigger_event: body.trigger_event ?? undefined,
      is_active: body.is_active ?? undefined,
    })
    .eq("id", body.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Replace steps if provided
  if (body.steps && Array.isArray(body.steps)) {
    await supabase.from("email_sequence_steps").delete().eq("sequence_id", body.id);
    await supabase.from("email_sequence_steps").insert(
      body.steps.map((step: any) => ({
        sequence_id: body.id,
        step_number: step.step_number,
        template_id: step.template_id,
        delay_hours: step.delay_hours ?? 24,
        send_time: step.send_time ?? null,
        condition: step.condition ?? null,
      }))
    );
  }

  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const id = url.searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { error } = await supabase.from("email_sequences").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
