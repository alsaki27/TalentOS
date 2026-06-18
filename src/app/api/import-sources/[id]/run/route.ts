import { NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { runAndRecord } from "@/lib/importSourceRunner";
import { supabase } from "@/lib/supabase";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const { data: source, error } = await supabase
    .from("import_sources")
    .select("*")
    .eq("id", params.id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  const result = await runAndRecord(source);
  return "error" in result
    ? NextResponse.json(result, { status: 502 })
    : NextResponse.json(result);
}
