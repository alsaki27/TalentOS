import type { UserRole } from "@/lib/auth";
import { normalizeUserRole } from "@/lib/auth";
import { execute, queryOne } from "@/server/db/neon";

export interface AuthProfileRow {
  user_id: string;
  email: string;
  display_name: string;
  role: UserRole;
  is_active: boolean;
  password_hash: string | null;
}

export async function countProfiles() {
  const row = await queryOne<{ count: number }>("SELECT COUNT(*)::int AS count FROM profiles");
  return row?.count ?? 0;
}

export async function findProfileByEmail(email: string) {
  const profile = await queryOne<{
    user_id: string;
    email: string;
    display_name: string;
    role: string;
    is_active: boolean;
    password_hash: string | null;
  }>(
    "SELECT user_id, email, display_name, role, is_active, password_hash FROM profiles WHERE LOWER(email) = $1",
    [email.toLowerCase()]
  );

  if (!profile) return null;

  return {
    ...profile,
    role: normalizeUserRole(profile.role),
  } satisfies AuthProfileRow;
}

export async function createProfile(input: {
  email: string;
  displayName: string;
  role: UserRole;
  passwordHash?: string | null;
  emailVerified?: boolean;
}) {
  const profile = await queryOne<{
    user_id: string;
    email: string;
    display_name: string;
    role: string;
    is_active: boolean;
    password_hash: string | null;
  }>(
    `INSERT INTO profiles (user_id, email, display_name, role, is_active, password_hash, email_verified, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     RETURNING user_id, email, display_name, role, is_active, password_hash`,
    [
      crypto.randomUUID(),
      input.email.toLowerCase(),
      input.displayName,
      input.role,
      true,
      input.passwordHash ?? null,
      input.emailVerified ?? false,
    ]
  );

  if (!profile) {
    throw new Error("Could not create profile.");
  }

  return {
    ...profile,
    role: normalizeUserRole(profile.role),
  } satisfies AuthProfileRow;
}

export async function createAuditLog(input: {
  actorUserId?: string | null;
  actorEmail?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await execute(
    "INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, entity_id, metadata) VALUES ($1, $2, $3, $4, $5, $6)",
    [input.actorUserId ?? null, input.actorEmail ?? null, input.action, input.entityType, input.entityId ?? null, input.metadata ?? null]
  );
}
