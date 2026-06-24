import { NextRequest, NextResponse } from "next/server";
import { DESTRUCTIVE_MANAGER_ROLES, getCurrentUserContext, hasRole } from "@/lib/auth";
import { gmailAuthUrl, newOAuthState } from "@/lib/integrations/googleGmail";
import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { execute } from "@/server/db/neon";

export async function GET(req: NextRequest) {
  const context = await getCurrentUserContext();
  if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const url = new URL(req.url);
  const owner = url.searchParams.get("owner") || "profile";
  const redirectAfter = url.searchParams.get("redirect") || "/account";

  if (owner === "shared" && !hasRole(context.profile, DESTRUCTIVE_MANAGER_ROLES)) {
    return NextResponse.json({ error: "Only admins and managers can connect the shared application Gmail." }, { status: 403 });
  }

  const ownerType = owner === "shared" ? "shared_application_mailbox" : "profile";
  const state = newOAuthState();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  if (isNeon()) {
    await execute(
      "INSERT INTO integration_oauth_states (state, provider, owner_type, owner_user_id, redirect_after, expires_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [state, "gmail", ownerType, ownerType === "profile" ? context.profile.user_id : null, redirectAfter, expiresAt]
    );
  } else {
    const { error } = await supabase.from("integration_oauth_states").insert({
      state,
      provider: "gmail",
      owner_type: ownerType,
      owner_user_id: ownerType === "profile" ? context.profile.user_id : null,
      redirect_after: redirectAfter,
      expires_at: expiresAt,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.redirect(gmailAuthUrl({ state, origin: url.origin }));
}
