import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const ALLOWED_FILTERS = [
  "search",
  "source",
  "roleTier",
  "active",
  "employmentType",
  "category",
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

  const { data, error } = await supabase
    .from("saved_job_searches")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const visible = (data ?? []).filter((search) =>
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
