import { NextResponse } from "next/server";
import { isNeon } from "@/server/db";
import { queryOne } from "@/server/db/neon";

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  let candidate: any;
  let candidateError: any;

  if (isNeon()) {
    candidate = await queryOne(
      `SELECT id, portal_token_expires_at, portal_token_revoked_at FROM candidates WHERE portal_token = $1`,
      [params.token]
    );
    candidateError = candidate ? null : { message: "Portal link not found." };
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("candidates")
      .select("id, portal_token_expires_at, portal_token_revoked_at")
      .eq("portal_token", params.token)
      .single();
    candidate = res.data;
    candidateError = res.error;
  }

  if (candidateError || !candidate) {
    return NextResponse.json({ error: "Portal link not found." }, { status: 404 });
  }
  if (
    candidate.portal_token_revoked_at
    || (candidate.portal_token_expires_at && new Date(candidate.portal_token_expires_at).getTime() < Date.now())
  ) {
    return NextResponse.json({ error: "Portal link expired." }, { status: 410 });
  }

  let data: any;
  let error: any;

  if (isNeon()) {
    data = await queryOne(
      `SELECT id, provider, owner_type, email, scopes, status, token_expires_at, last_synced_at, created_at, updated_at FROM integration_accounts WHERE provider = 'gmail' AND owner_type = 'candidate' AND candidate_id = $1`,
      [candidate.id]
    );
    error = null;
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("integration_accounts")
      .select("id, provider, owner_type, email, scopes, status, token_expires_at, last_synced_at, created_at, updated_at")
      .eq("provider", "gmail")
      .eq("owner_type", "candidate")
      .eq("candidate_id", candidate.id)
      .maybeSingle();
    data = res.data ?? null;
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? null);
}
