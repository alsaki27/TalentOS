import { query, queryOne, execute } from "@/server/db/neon";

export interface ProfileRow {
  user_id: string;
  email: string | null;
  display_name: string;
  role: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  password_hash?: string | null;
}

export async function findProfileByUserId(userId: string): Promise<ProfileRow | null> {
  return queryOne<ProfileRow>("SELECT * FROM profiles WHERE user_id = $1", [userId]);
}

export async function listActiveProfiles(): Promise<ProfileRow[]> {
  return query<ProfileRow>("SELECT * FROM profiles WHERE is_active = true ORDER BY display_name ASC");
}

export async function listAllProfiles(): Promise<ProfileRow[]> {
  return query<ProfileRow>("SELECT * FROM profiles ORDER BY display_name ASC");
}

export async function upsertProfile(input: { user_id: string; email?: string; display_name?: string; role?: string; is_active?: boolean }): Promise<ProfileRow> {
  const rows = await query<ProfileRow>(
    `INSERT INTO profiles (user_id, email, display_name, role, is_active)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET
       email = COALESCE(EXCLUDED.email, profiles.email),
       display_name = COALESCE(EXCLUDED.display_name, profiles.display_name),
       role = COALESCE(EXCLUDED.role, profiles.role),
       is_active = COALESCE(EXCLUDED.is_active, profiles.is_active),
       updated_at = NOW()
     RETURNING *`,
    [input.user_id, input.email ?? null, input.display_name ?? "", input.role ?? "recruiter", input.is_active ?? true]
  );
  return rows[0];
}

export async function updatePasswordHash(userId: string, hash: string): Promise<void> {
  await execute("UPDATE profiles SET password_hash = $1, updated_at = NOW() WHERE user_id = $2", [hash, userId]);
}

export async function findProfileByEmail(email: string): Promise<ProfileRow | null> {
  return queryOne<ProfileRow>("SELECT * FROM profiles WHERE email = $1", [email]);
}

export async function findProfilePasswordHash(userId: string): Promise<{ password_hash: string } | null> {
  return queryOne<{ password_hash: string }>("SELECT password_hash FROM profiles WHERE user_id = $1", [userId]);
}

export async function listProfilesByUserIds(userIds: string[]): Promise<ProfileRow[]> {
  if (userIds.length === 0) return [];
  return query<ProfileRow>("SELECT * FROM profiles WHERE user_id = ANY($1)", [userIds]);
}
