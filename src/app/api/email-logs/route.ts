// src/app/api/email-logs/route.ts
// GET  -> list logs with pagination, filters
// POST -> create log entry (used by email service)
// PATCH /:id/track -> track open/click

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
  const candidateId = url.searchParams.get("candidateId") || "";
  const templateId = url.searchParams.get("templateId") || "";
  const sequenceId = url.searchParams.get("sequenceId") || "";
  const status = url.searchParams.get("status") || "";
  const dateFrom = url.searchParams.get("dateFrom") || "";
  const dateTo = url.searchParams.get("dateTo") || "";
  const search = (url.searchParams.get("search") || "").trim().replace(/[,()]/g, "");

  let query = supabase.from("email_logs").select("*, candidates(id,name,email,avatar_url), templates:email_templates(id,name,category)", { count: "exact" }).order("sent_at", { ascending: false });

  if (candidateId) query = query.eq("candidate_id", candidateId);
  if (templateId) query = query.eq("template_id", templateId);
  if (sequenceId) query = query.eq("sequence_id", sequenceId);
  if (status) query = query.eq("status", status);
  if (dateFrom) query = query.gte("sent_at", dateFrom);
  if (dateTo) query = query.lte("sent_at", dateTo);
  if (search) query = query.or(`subject.ilike.%${search}%`);

  const from = (page - 1) * pageSize;
  const { data, error, count } = await query.range(from, from + pageSize - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [], total: count ?? 0, page, pageSize });
}

export async function POST(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const body = await req.json();

  const { data, error } = await supabase
    .from("email_logs")
    .insert({
      candidate_id: body.candidate_id,
      template_id: body.template_id ?? null,
      sequence_id: body.sequence_id ?? null,
      step_number: body.step_number ?? null,
      subject: body.subject,
      body: body.body,
      status: body.status ?? "sent",
      sent_by: body.sent_by ?? null,
      sent_at: body.sent_at ?? new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const body = await req.json();
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const updates: Record<string, any> = {};
  if (body.opened_at) updates.opened_at = body.opened_at;
  if (body.clicked_at) updates.clicked_at = body.clicked_at;
  if (body.replied_at) updates.replied_at = body.replied_at;
  if (body.status) updates.status = body.status;

  const { data, error } = await supabase
    .from("email_logs")
    .update(updates)
    .eq("id", body.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
