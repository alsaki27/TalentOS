import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { isNeon } from "@/server/db";
import { query, queryOne } from "@/server/db/neon";

const ALLOWED_FILTERS = [
  "search",
  "source",
  "roleTier",
  "active",
  "employmentType",
  "category",
  "workAuthorization",
  "dateStart",
  "dateEnd",
  "candidate",
  "assignedBy",
  "owner",
  "score",
  "sort",
] as const;

function cleanFilters(input: unknown) {
  const raw = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
  const filters: Record<string, string> = {};
  for (const key of ALLOWED_FILTERS) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) filters[key] = value.trim();
  }
  return filters;
}

export async function GET() {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  let data: any[] = [];
  if (isNeon()) {
    data = await query<any>(`SELECT * FROM saved_job_searches ORDER BY created_at DESC`);
  } else {
    const { supabase } = await import("@/lib/supabase");
    const { data: d, error } = await supabase
      .from("saved_job_searches")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    data = d ?? [];
  }

  const visible = data.filter((search: any) =>
    search.is_shared || search.owner_user_id === context.profile.user_id
  );
  return NextResponse.json(visible);
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();
  const label = body.label?.trim();
  const filters = cleanFilters(body.filters);

  if (!label) return NextResponse.json({ error: "label is required" }, { status: 400 });
  if (Object.keys(filters).length === 0) {
    return NextResponse.json({ error: "Save at least one active filter." }, { status: 400 });
  }

  if (isNeon()) {
    const data = await queryOne<any>(`INSERT INTO saved_job_searches (label, filters, is_shared, owner_user_id) VALUES ($1, $2, $3, $4) RETURNING *`, [label, filters, body.is_shared !== false, context.profile.user_id]);
    return NextResponse.json(data, { status: 201 });
  } else {
    const { supabase } = await import("@/lib/supabase");
    const { data, error } = await supabase
      .from("saved_job_searches")
      .insert({
        label,
        filters,
        is_shared: body.is_shared !== false,
        owner_user_id: context.profile.user_id,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  }
}
