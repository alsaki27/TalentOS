import { NextRequest, NextResponse } from "next/server";
import { exchangeGmailCode, getGoogleEmail, GMAIL_SCOPES } from "@/lib/integrations/googleGmail";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) return NextResponse.redirect(new URL(`/account?gmail=error&reason=${encodeURIComponent(error)}`, url.origin));
  if (!code || !state) return NextResponse.json({ error: "code and state are required" }, { status: 400 });

  const { data: oauthState, error: stateError } = await supabase
    .from("integration_oauth_states")
    .select("*")
    .eq("state", state)
    .eq("provider", "gmail")
    .single();

  if (stateError || !oauthState) {
    return NextResponse.json({ error: "Invalid OAuth state." }, { status: 400 });
  }
  if (new Date(oauthState.expires_at).getTime() < Date.now()) {
    await supabase.from("integration_oauth_states").delete().eq("state", state);
    return NextResponse.json({ error: "OAuth state expired." }, { status: 400 });
  }

  try {
    const token = await exchangeGmailCode(code, url.origin);
    const email = await getGoogleEmail(token.access_token, token.id_token);
    const expiresAt = token.expires_in
      ? new Date(Date.now() + token.expires_in * 1000).toISOString()
      : null;

    const payload = {
      provider: "gmail",
      owner_type: oauthState.owner_type,
      owner_user_id: oauthState.owner_user_id,
      candidate_id: oauthState.candidate_id,
      email,
      scopes: token.scope ? token.scope.split(/\s+/) : GMAIL_SCOPES,
      access_token: token.access_token,
      refresh_token: token.refresh_token ?? null,
      token_expires_at: expiresAt,
      status: "active",
      metadata: { token_type: token.token_type ?? "Bearer" },
      updated_at: new Date().toISOString(),
    };

    let existingQuery = supabase
      .from("integration_accounts")
      .select("id")
      .eq("provider", "gmail")
      .eq("owner_type", oauthState.owner_type)
      .limit(1);

    if (oauthState.owner_type === "candidate") existingQuery = existingQuery.eq("candidate_id", oauthState.candidate_id);
    if (oauthState.owner_type === "profile") existingQuery = existingQuery.eq("owner_user_id", oauthState.owner_user_id);

    const { data: existing } = await existingQuery;
    const existingId = existing?.[0]?.id;

    const { error: upsertError } = existingId
      ? await supabase.from("integration_accounts").update(payload).eq("id", existingId)
      : await supabase.from("integration_accounts").insert(payload);

    if (upsertError) throw upsertError;

    await Promise.all([
      supabase.from("integration_oauth_states").delete().eq("state", state),
      supabase.from("audit_logs").insert({
        actor_user_id: oauthState.owner_user_id,
        actor_email: email,
        action: "integration.gmail.connected",
        entity_type: "integration_account",
        metadata: { owner_type: oauthState.owner_type, candidate_id: oauthState.candidate_id, email },
      }),
    ]);

    const redirectAfter = oauthState.redirect_after || "/account";
    return NextResponse.redirect(new URL(`${redirectAfter}${redirectAfter.includes("?") ? "&" : "?"}gmail=connected`, url.origin));
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Gmail OAuth callback failed." }, { status: 500 });
  }
}
