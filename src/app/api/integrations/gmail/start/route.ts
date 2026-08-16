import { NextRequest, NextResponse } from "next/server";
import { DESTRUCTIVE_MANAGER_ROLES, getCurrentUserContext, hasRole } from "@/lib/auth";
import { gmailAuthUrl, newOAuthState } from "@/lib/integrations/googleGmail";
import { execute, queryOne } from "@/server/db/neon";

export async function GET(req: NextRequest) {
  const context = await getCurrentUserContext();
  if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const url = new URL(req.url);
  const owner = url.searchParams.get("owner") || "profile";
  const redirectAfter = url.searchParams.get("redirect") || "/account";
  const candidateId = url.searchParams.get("candidateId");

  if (owner === "candidate") {
    if (!hasRole(context.profile, DESTRUCTIVE_MANAGER_ROLES)) {
      return NextResponse.json({ error: "Only admins and managers can connect a client's Gmail." }, { status: 403 });
    }
    if (!candidateId) return NextResponse.json({ error: "candidateId is required." }, { status: 400 });
    const candidate = await queryOne<{ id: string }>("SELECT id FROM candidates WHERE id = $1", [candidateId]);
    if (!candidate) return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
  }

  if (owner === "shared" && !hasRole(context.profile, DESTRUCTIVE_MANAGER_ROLES)) {
    return NextResponse.json({ error: "Only admins and managers can connect the shared application Gmail." }, { status: 403 });
  }

  const ownerType = owner === "candidate" ? "candidate" : owner === "shared" ? "shared_application_mailbox" : "profile";
  const state = newOAuthState();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await execute(
    "INSERT INTO integration_oauth_states (state, provider, owner_type, owner_user_id, redirect_after, expires_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [state, "gmail", ownerType, context.profile.user_id, redirectAfter, expiresAt]
  );
  if (ownerType === "candidate") {
    await execute("UPDATE integration_oauth_states SET candidate_id = $1 WHERE state = $2", [candidateId, state]);
  }

  return NextResponse.redirect(gmailAuthUrl({ state }));
}
