// src/app/api/email-templates/route.ts
// GET  -> list templates with pagination, filter by category
// POST -> create template
// PATCH -> update template
// DELETE -> delete template

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { query, queryOne, execute } from "@/server/db/neon";

export const dynamic = "force-dynamic";

const ALLOWED_TAGS = [
  "candidate_name",
  "job_title",
  "company_name",
  "interviewer_name",
  "interview_date",
  "interview_time",
  "interview_link",
  "portal_url",
];

function validateMergeTags(body: string): string[] {
  const matches = body.match(/\{\{([a-zA-Z0-9_]+)\}\}/g) ?? [];
  const invalid: string[] = [];
  for (const match of matches) {
    const key = match.replace(/\{\{|\}\}/g, "");
    if (!ALLOWED_TAGS.includes(key)) invalid.push(match);
  }
  return [...new Set(invalid)];
}

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10) || 50));
  const category = url.searchParams.get("category") || "";
  const search = (url.searchParams.get("search") || "").trim().replace(/[,()]/g, "");

  if (isNeon()) {
    const offset = (page - 1) * pageSize;
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (category) {
      conditions.push(`category = $${idx++}`);
      params.push(category);
    }
    if (search) {
      conditions.push(`(name ILIKE $${idx} OR subject ILIKE $${idx + 1})`);
      params.push(`%${search}%`, `%${search}%`);
      idx += 2;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const countSql = `SELECT COUNT(*) as count FROM email_templates ${whereClause}`;
    const countRow = await queryOne<{ count: string }>(countSql, params);
    const total = parseInt(countRow?.count ?? "0", 10);

    const dataSql = `SELECT * FROM email_templates ${whereClause} ORDER BY created_at DESC OFFSET $${idx++} LIMIT $${idx++}`;
    const data = await query(dataSql, [...params, offset, pageSize]);

    return NextResponse.json({ items: data ?? [], total, page, pageSize });
  }

  let dbQuery = supabase.from("email_templates").select("*", { count: "exact" }).order("created_at", { ascending: false });

  if (category) dbQuery = dbQuery.eq("category", category);
  if (search) dbQuery = dbQuery.or(`name.ilike.%${search}%,subject.ilike.%${search}%`);

  const from = (page - 1) * pageSize;
  const { data, error, count } = await dbQuery.range(from, from + pageSize - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [], total: count ?? 0, page, pageSize });
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const body = await req.json();

  if (!body.name || !body.subject || !body.body) {
    return NextResponse.json({ error: "name, subject, and body are required" }, { status: 400 });
  }

  const invalidTags = validateMergeTags(body.body).concat(validateMergeTags(body.subject));
  if (invalidTags.length > 0) {
    return NextResponse.json({ error: `Invalid merge tags: ${invalidTags.join(", ")}` }, { status: 400 });
  }

  if (isNeon()) {
    const data = await queryOne(
      `INSERT INTO email_templates (name, subject, body, category, is_default, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [body.name, body.subject, body.body, body.category ?? "general", body.is_default ?? false, context.profile.user_id]
    );
    if (!data) return NextResponse.json({ error: "Insert failed" }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  }

  const { data, error } = await supabase
    .from("email_templates")
    .insert({
      name: body.name,
      subject: body.subject,
      body: body.body,
      category: body.category ?? "general",
      is_default: body.is_default ?? false,
      created_by: context.profile.user_id,
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

  const invalidTags = validateMergeTags(body.body ?? "").concat(validateMergeTags(body.subject ?? ""));
  if (invalidTags.length > 0) {
    return NextResponse.json({ error: `Invalid merge tags: ${invalidTags.join(", ")}` }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (body.name != null) updates.name = body.name;
  if (body.subject != null) updates.subject = body.subject;
  if (body.body != null) updates.body = body.body;
  if (body.category != null) updates.category = body.category;
  if (body.is_default != null) updates.is_default = body.is_default;

  if (isNeon()) {
    const keys = Object.keys(updates);
    if (keys.length === 0) return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = keys.map((k) => updates[k]) as (string | number | boolean | null | Date | object)[];
    values.push(body.id);
    const data = await queryOne(
      `UPDATE email_templates SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
      values
    );
    if (!data) return NextResponse.json({ error: "Update failed" }, { status: 500 });
    return NextResponse.json(data);
  }

  const { data, error } = await supabase
    .from("email_templates")
    .update({
      name: body.name ?? undefined,
      subject: body.subject ?? undefined,
      body: body.body ?? undefined,
      category: body.category ?? undefined,
      is_default: body.is_default ?? undefined,
    })
    .eq("id", body.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const id = url.searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  if (isNeon()) {
    await execute("DELETE FROM email_templates WHERE id = $1", [id]);
    return NextResponse.json({ success: true });
  }

  const { error } = await supabase.from("email_templates").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
