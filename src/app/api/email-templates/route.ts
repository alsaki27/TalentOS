// src/app/api/email-templates/route.ts
// GET  -> list templates with pagination, filter by category
// POST -> create template
// PATCH -> update template
// DELETE -> delete template

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

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

  let query = supabase.from("email_templates").select("*", { count: "exact" }).order("created_at", { ascending: false });

  if (category) query = query.eq("category", category);
  if (search) query = query.or(`name.ilike.%${search}%,subject.ilike.%${search}%`);

  const from = (page - 1) * pageSize;
  const { data, error, count } = await query.range(from, from + pageSize - 1);

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

  const { error } = await supabase.from("email_templates").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
