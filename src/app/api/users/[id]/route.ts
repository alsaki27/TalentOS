import { NextRequest, NextResponse } from "next/server";
import { publicUserProfile, requireCurrentUser, type UserRole } from "@/lib/auth";
import { queryOne, sql } from "@/server/db/neon";

const roles: UserRole[] = ["admin", "manager", "application_engineer"];

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const body = await req.json();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if ("display_name" in body) updates.display_name = String(body.display_name ?? "").trim();
  if ("email" in body) updates.email = body.email ? String(body.email).trim() : null;
  if ("is_active" in body) updates.is_active = Boolean(body.is_active);
  if ("role" in body) {
    if (!roles.includes(body.role)) {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    }
    updates.role = body.role;
  }

  const entries = Object.entries(updates);
  const setClauses = entries.map(([key], i) => `${key} = $${i + 1}`);
  const sqlParams = entries.map(([, val]) => val);
  sqlParams.push(params.id);
  const data = await queryOne<any>(`UPDATE profiles SET ${setClauses.join(", ")} WHERE user_id = $${sqlParams.length} RETURNING user_id, email, display_name, role, is_active`, sqlParams);
  return NextResponse.json(data ? publicUserProfile(data as any) : null);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const memberId = params.id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(memberId)) {
    return NextResponse.json({ error: "Invalid team member ID." }, { status: 400 });
  }
  if (context!.profile.user_id === memberId) {
    return NextResponse.json({ error: "You cannot delete your own account." }, { status: 400 });
  }

  const existing = await queryOne<{ user_id: string; role: string; is_active: boolean }>(
    "SELECT user_id, role, is_active FROM profiles WHERE user_id = $1",
    [memberId],
  );
  if (!existing) return NextResponse.json({ error: "Team member not found." }, { status: 404 });

  const deletionSchema = await queryOne<{ ready: boolean }>(
    `SELECT
       EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'extension_activity_events' AND column_name = 'actor_display_name'
       )
       AND EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'extension_activity_events' AND column_name = 'actor_email'
       )
       AND EXISTS (
         SELECT 1 FROM pg_trigger
          WHERE tgrelid = to_regclass('public.profiles')
            AND tgname = 'profiles_anonymize_deleted_member_activity'
            AND NOT tgisinternal
       )
       AND EXISTS (
         SELECT 1 FROM pg_constraint
          WHERE conrelid = to_regclass('public.extension_activity_events')
            AND conname = 'extension_activity_events_actor_user_id_fkey'
            AND contype = 'f'
            AND confdeltype = 'n'
       ) AS ready`,
  );
  if (!deletionSchema?.ready) {
    return NextResponse.json(
      { error: "Team member deletion is not enabled until database migration 122 is applied." },
      { status: 503 },
    );
  }

  try {
    // The advisory lock serializes team deletions; row locks protect the target
    // and active admins while the final-admin guard and deletion run together.
    const results = await sql().transaction((tx) => [
      tx`SELECT pg_advisory_xact_lock(hashtext('talentos_team_member_delete'))`,
      tx`SELECT user_id FROM profiles WHERE user_id = ${memberId} FOR UPDATE`,
      tx`SELECT user_id FROM profiles WHERE role = 'admin' AND is_active = true FOR UPDATE`,
      tx`INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, entity_id, metadata)
         SELECT ${context!.profile.user_id}, ${context!.profile.email}, 'user.deleted', 'profile', target.user_id,
                jsonb_build_object('role', target.role, 'attribution', 'Deleted member')
           FROM profiles target
          WHERE target.user_id = ${memberId}
            AND (target.role <> 'admin' OR NOT target.is_active OR
                 (SELECT COUNT(*) FROM profiles WHERE role = 'admin' AND is_active = true) > 1)`,
      tx`DELETE FROM profiles
          WHERE user_id = ${memberId}
            AND (role <> 'admin' OR NOT is_active OR
                 (SELECT COUNT(*) FROM profiles WHERE role = 'admin' AND is_active = true) > 1)
          RETURNING user_id`,
    ]);

    const deleted = results[4] as Array<{ user_id: string }>;
    if (deleted.length === 0) {
      if (existing.role === "admin" && existing.is_active) {
        return NextResponse.json({ error: "The last active admin account cannot be deleted." }, { status: 409 });
      }
      return NextResponse.json({ error: "Team member no longer exists." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[users] Failed to permanently delete team member", error);
    return NextResponse.json({ error: "Could not delete this team member. No changes were committed." }, { status: 500 });
  }
}
