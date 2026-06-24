import { NextRequest, NextResponse } from "next/server";
import { exchangeGmailCode, getGoogleEmail, GMAIL_SCOPES } from "@/lib/integrations/googleGmail";
import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { query, queryOne, execute } from "@/server/db/neon";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) return NextResponse.redirect(new URL(`/account?gmail=error&reason=${encodeURIComponent(error)}`, url.origin));
  if (!code || !state) return NextResponse.json({ error: "code and state are required" }, { status: 400 });

  if (isNeon()) {
    const oauthState = await queryOne<{ state: string; provider: string; expires_at: string; owner_type: string; owner_user_id: string | null; candidate_id: string | null; redirect_after: string | null }>(
      "SELECT state, provider, expires_at, owner_type, owner_user_id, candidate_id, redirect_after FROM integration_oauth_states WHERE state = $1 AND provider = $2",
      [state, "gmail"]
    );
    if (!oauthState) {
      return NextResponse.json({ error: "Invalid OAuth state." }, { status: 400 });
    }
    if (new Date(oauthState.expires_at).getTime() < Date.now()) {
      await execute("DELETE FROM integration_oauth_states WHERE state = $1", [state]);
      return NextResponse.json({ error: "OAuth state expired." }, { status: 400 });
    }

    try {
      const token = await exchangeGmailCode(code, url.origin);
      const email = await getGoogleEmail(token.access_token, token.id_token);
      const expiresAt = token.expires_in
        ? new Date(Date.now() + token.expires_in * 1000).toISOString()
        : null;

      const payload = {
        provider: "gmail" as const,
        owner_type: oauthState.owner_type,
        owner_user_id: oauthState.owner_user_id,
        candidate_id: oauthState.candidate_id,
        email,
        scopes: token.scope ? token.scope.split(/\s+/) : GMAIL_SCOPES,
        access_token: token.access_token,
        refresh_token: token.refresh_token ?? null,
        token_expires_at: expiresAt,
        status: "active" as const,
        metadata: { token_type: token.token_type ?? "Bearer" },
        updated_at: new Date().toISOString(),
      };

      let existingId: string | null = null;
      if (oauthState.owner_type === "candidate") {
        const existing = await queryOne<{ id: string }>(
          "SELECT id FROM integration_accounts WHERE provider = $1 AND owner_type = $2 AND candidate_id = $3 LIMIT 1",
          [payload.provider, payload.owner_type, payload.candidate_id]
        );
        existingId = existing?.id ?? null;
      } else if (oauthState.owner_type === "profile") {
        const existing = await queryOne<{ id: string }>(
          "SELECT id FROM integration_accounts WHERE provider = $1 AND owner_type = $2 AND owner_user_id = $3 LIMIT 1",
          [payload.provider, payload.owner_type, payload.owner_user_id]
        );
        existingId = existing?.id ?? null;
      } else {
        const existing = await queryOne<{ id: string }>(
          "SELECT id FROM integration_accounts WHERE provider = $1 AND owner_type = $2 LIMIT 1",
          [payload.provider, payload.owner_type]
        );
        existingId = existing?.id ?? null;
      }

      if (existingId) {
        await execute(
          "UPDATE integration_accounts SET provider = $1, owner_type = $2, owner_user_id = $3, candidate_id = $4, email = $5, scopes = $6, access_token = $7, refresh_token = $8, token_expires_at = $9, status = $10, metadata = $11, updated_at = $12 WHERE id = $13",
          [payload.provider, payload.owner_type, payload.owner_user_id, payload.candidate_id, payload.email, payload.scopes, payload.access_token, payload.refresh_token, payload.token_expires_at, payload.status, payload.metadata, payload.updated_at, existingId]
        );
      } else {
        await execute(
          "INSERT INTO integration_accounts (provider, owner_type, owner_user_id, candidate_id, email, scopes, access_token, refresh_token, token_expires_at, status, metadata, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
          [payload.provider, payload.owner_type, payload.owner_user_id, payload.candidate_id, payload.email, payload.scopes, payload.access_token, payload.refresh_token, payload.token_expires_at, payload.status, payload.metadata, payload.updated_at]
        );
      }

      await execute("DELETE FROM integration_oauth_states WHERE state = $1", [state]);
      await execute(
        "INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, metadata) VALUES ($1, $2, $3, $4, $5)",
        [oauthState.owner_user_id, email, "integration.gmail.connected", "integration_account", { owner_type: oauthState.owner_type, candidate_id: oauthState.candidate_id, email }]
      );

      const redirectAfter = oauthState.redirect_after || "/account";
      return NextResponse.redirect(new URL(`${redirectAfter}${redirectAfter.includes("?") ? "&" : "?"}gmail=connected`, url.origin));
    } catch (err: any) {
      return NextResponse.json({ error: err.message || "Gmail OAuth callback failed." }, { status: 500 });
    }
  }

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
