import { NextRequest, NextResponse } from "next/server";
import { gmailAuthUrl, newOAuthState } from "@/lib/integrations/googleGmail";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const { data: candidate, error: candidateError } = await supabase
    .from("candidates")
    .select("id")
    .eq("portal_token", params.token)
    .single();

  if (candidateError || !candidate) {
    return NextResponse.json({ error: "Portal link not found." }, { status: 404 });
  }

  const url = new URL(req.url);
  const state = newOAuthState();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const { error } = await supabase.from("integration_oauth_states").insert({
    state,
    provider: "gmail",
    owner_type: "candidate",
    candidate_id: candidate.id,
    redirect_after: `/portal/${params.token}`,
    expires_at: expiresAt,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.redirect(gmailAuthUrl({ state, origin: url.origin }));
}
