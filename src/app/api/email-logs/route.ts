// src/app/api/email-logs/route.ts
// GET  -> list logs with pagination, filters
// POST -> create log entry (used by email service)
// PATCH /:id/track -> track open/click

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { query, queryOne, execute } from "@/server/db/neon";

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

  if (isNeon()) {
    const offset = (page - 1) * pageSize;
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (candidateId) { conditions.push(`candidate_id = $${idx++}`); params.push(candidateId); }
    if (templateId) { conditions.push(`template_id = $${idx++}`); params.push(templateId); }
    if (sequenceId) { conditions.push(`sequence_id = $${idx++}`); params.push(sequenceId); }
    if (status) { conditions.push(`status = $${idx++}`); params.push(status); }
    if (dateFrom) { conditions.push(`sent_at >= $${idx++}`); params.push(dateFrom); }
    if (dateTo) { conditions.push(`sent_at <= $${idx++}`); params.push(dateTo); }
    if (search) { conditions.push(`subject ILIKE $${idx++}`); params.push(`%${search}%`); }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countSql = `SELECT COUNT(*) as count FROM email_logs ${whereClause}`;
    const countRow = await queryOne<{ count: string }>(countSql, params);
    const total = parseInt(countRow?.count ?? "0", 10);

    const dataSql = `
      SELECT e.*,
        CASE WHEN c.id IS NOT NULL THEN jsonb_build_object('id', c.id, 'name', c.name, 'email', c.email, 'avatar_url', c.avatar_url) END as candidates,
        CASE WHEN t.id IS NOT NULL THEN jsonb_build_object('id', t.id, 'name', t.name, 'category', t.category) END as templates
      FROM email_logs e
      LEFT JOIN candidates c ON e.candidate_id = c.id
      LEFT JOIN email_templates t ON e.template_id = t.id
      ${whereClause}
      ORDER BY e.sent_at DESC
      OFFSET $${idx++} LIMIT $${idx++}
    `;
    const data = await query(dataSql, [...params, offset, pageSize]);

    return NextResponse.json({ items: data ?? [], total, page, pageSize });
  }

  let dbQuery = supabase.from("email_logs").select("*, candidates(id,name,email,avatar_url), templates:email_templates(id,name,category)", { count: "exact" }).order("sent_at", { ascending: false });

  if (candidateId) dbQuery = dbQuery.eq("candidate_id", candidateId);
  if (templateId) dbQuery = dbQuery.eq("template_id", templateId);
  if (sequenceId) dbQuery = dbQuery.eq("sequence_id", sequenceId);
  if (status) dbQuery = dbQuery.eq("status", status);
  if (dateFrom) dbQuery = dbQuery.gte("sent_at", dateFrom);
  if (dateTo) dbQuery = dbQuery.lte("sent_at", dateTo);
  if (search) dbQuery = dbQuery.or(`subject.ilike.%${search}%`);

  const from = (page - 1) * pageSize;
  const { data, error, count } = await dbQuery.range(from, from + pageSize - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [], total: count ?? 0, page, pageSize });
}

export async function POST(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const body = await req.json();

  if (isNeon()) {
    const data = await queryOne(
      `INSERT INTO email_logs (candidate_id, template_id, sequence_id, step_number, subject, body, status, sent_by, sent_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [body.candidate_id ?? null, body.template_id ?? null, body.sequence_id ?? null, body.step_number ?? null, body.subject, body.body, body.status ?? "sent", body.sent_by ?? null, body.sent_at ?? new Date().toISOString()]
    );
    if (!data) return NextResponse.json({ error: "Insert failed" }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  }

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

  if (isNeon()) {
    const keys = Object.keys(updates);
    if (keys.length === 0) return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = keys.map((k) => updates[k]) as (string | number | boolean | null | Date | object)[];
    values.push(body.id);
    const data = await queryOne(
      `UPDATE email_logs SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
      values
    );
    if (!data) return NextResponse.json({ error: "Update failed" }, { status: 500 });
    return NextResponse.json(data);
  }

  const { data, error } = await supabase
    .from("email_logs")
    .update(updates)
    .eq("id", body.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
