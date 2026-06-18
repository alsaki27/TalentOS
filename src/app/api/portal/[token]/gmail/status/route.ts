import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const { data: candidate, error: candidateError } = await supabase
    .from("candidates")
    .select("id")
    .eq("portal_token", params.token)
    .single();

  if (candidateError || !candidate) {
    return NextResponse.json({ error: "Portal link not found." }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("integration_accounts")
    .select("id, provider, owner_type, email, scopes, status, token_expires_at, last_synced_at, created_at, updated_at")
    .eq("provider", "gmail")
    .eq("owner_type", "candidate")
    .eq("candidate_id", candidate.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? null);
}
