import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query, queryOne } from "@/server/db/neon";
import {
  createScheduledLoggingSession,
  constantTimeEqual,
  derivePasswordHash,
  hasScheduledLoggingSession,
  revokeScheduledLoggingSession,
  SCHEDULED_LOGGING_COOKIE,
} from "@/server/security/scheduledCandidateLoggingAuth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;
  try {
    const body = await request.json();
    const action = String(body?.action ?? "unlock");
    if (!["unlock", "set", "logout"].includes(action)) return NextResponse.json({ error: "Unsupported access action." }, { status: 400 });
    const token = request.cookies.get(SCHEDULED_LOGGING_COOKIE)?.value;

    if (action === "logout") {
      if (token) await revokeScheduledLoggingSession(token, context.profile.user_id);
      const out = NextResponse.json({ ok: true });
      out.cookies.set(SCHEDULED_LOGGING_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/api/admin/scheduled-job-logging", maxAge: 0 });
      return out;
    }

    const config = await queryOne<{ password_salt: string | null; password_hash: string | null }>(
      "SELECT password_salt, password_hash FROM scheduled_candidate_logging_config WHERE id = true",
    );
    if (!config) return NextResponse.json({ error: "Feature migration is not installed." }, { status: 503 });

    const password = typeof body?.password === "string" ? body.password : "";
    let didSetPassword = false;
    if (!config.password_hash) {
      if (password.length < 12) return NextResponse.json({ error: "Set a password with at least 12 characters." }, { status: 400 });
      const salt = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
      const hash = await derivePasswordHash(password, salt);
      const saved = await queryOne(
        `UPDATE scheduled_candidate_logging_config
            SET password_salt = $1, password_hash = $2, updated_by_user_id = $3, updated_at = NOW()
          WHERE id = true AND password_hash IS NULL RETURNING id`,
        [salt, hash, context.profile.user_id],
      );
      if (!saved) return NextResponse.json({ error: "The feature password was just set by another administrator. Unlock it with that password." }, { status: 409 });
      didSetPassword = true;
    } else {
      if (action === "set") {
        if (!(await hasScheduledLoggingSession(context.profile.user_id)) || password.length < 12) {
          return NextResponse.json({ error: "Unlock first, then enter a new password of at least 12 characters." }, { status: 400 });
        }
        const salt = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
        const hash = await derivePasswordHash(password, salt);
        const saved = await queryOne(
          `UPDATE scheduled_candidate_logging_config SET password_salt = $1, password_hash = $2,
             updated_by_user_id = $3, updated_at = NOW() WHERE id = true RETURNING id`,
          [salt, hash, context.profile.user_id],
        );
        if (!saved) return NextResponse.json({ error: "Could not update the access password." }, { status: 500 });
        didSetPassword = true;
      } else {
        const supplied = await derivePasswordHash(password, config.password_salt ?? "");
        if (!password || !constantTimeEqual(supplied, config.password_hash ?? "")) return NextResponse.json({ error: "Password did not match." }, { status: 401 });
      }
    }

    if (didSetPassword) {
      await query("DELETE FROM scheduled_candidate_logging_sessions");
    }
    const sessionToken = await createScheduledLoggingSession(context.profile.user_id);
    const out = NextResponse.json({ ok: true, passwordSet: didSetPassword });
    out.cookies.set(SCHEDULED_LOGGING_COOKIE, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/api/admin/scheduled-job-logging",
      maxAge: 8 * 60 * 60,
    });
    return out;
  } catch (error) {
    console.error("[Scheduled candidate logging] Access gate request failed:", error);
    // Matches this app's established pattern elsewhere (e.g.
    // candidates/[id]/route.ts) of surfacing error.message rather than a
    // generic string - this route is already gated by requireCurrentUser(["admin"])
    // above, so only an authenticated TalentOS admin ever sees it.
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Could not verify feature access.",
    }, { status: 500 });
  }
}
