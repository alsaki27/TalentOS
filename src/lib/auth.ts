import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifyJWT } from "@/server/auth/jwt";
import { queryOne } from "@/server/db/neon";
import { normalizeUserRole } from "@/lib/auth-edge";
import type { UserRole } from "@/lib/auth-edge";

export {
  ALL_USER_ROLES,
  canAccessPath,
  getDefaultRouteForRole,
  getRoleLabel,
  normalizeUserRole,
} from "@/lib/auth-edge";
export type { LegacyUserRole, UserRole } from "@/lib/auth-edge";

export const ACCESS_TOKEN_COOKIE = "skarion_access_token";
export const REFRESH_TOKEN_COOKIE = "skarion_refresh_token";
export const GOOGLE_OAUTH_STATE_COOKIE = "skarion_google_oauth_state";
export const POST_AUTH_REDIRECT_COOKIE = "skarion_post_auth_redirect";

export interface UserProfile {
  user_id: string;
  email: string | null;
  display_name: string;
  role: UserRole;
  is_active: boolean;
}

export interface CurrentUserContext {
  user: { id: string; email: string | null };
  profile: UserProfile;
}

export const ASSIGNMENT_MANAGER_ROLES: UserRole[] = ["admin", "manager", "application_engineer"];
export const APPLICATION_WORKER_ROLES: UserRole[] = ["admin", "manager", "application_engineer"];
export const MASTER_DATA_MANAGER_ROLES: UserRole[] = ["admin", "manager"];
export const DESTRUCTIVE_MANAGER_ROLES: UserRole[] = ["admin", "manager"];
export const FALOOD_REVIEWER_ROLES: UserRole[] = ["admin", "manager", "application_engineer"];

export function sanitizeInternalPath(path: string | null | undefined) {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return null;
  return path;
}

export function hasRole(profile: UserProfile, roles: UserRole[]) {
  return roles.includes(normalizeUserRole(profile.role));
}

function normalizeUserProfile<T extends Pick<UserProfile, "role">>(profile: T): T {
  return {
    ...profile,
    role: normalizeUserRole(profile.role),
  };
}

export async function getCurrentUserContext(): Promise<CurrentUserContext | null> {
  const token = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!token) return null;

  const jwtPayload = await verifyJWT(token);
  if (!jwtPayload) return null;

  const profile = await queryOne<UserProfile>(
    "SELECT user_id, email, display_name, role, is_active FROM profiles WHERE user_id = $1",
    [jwtPayload.user_id]
  );

  if (!profile || !profile.is_active) return null;
  const normalizedProfile = normalizeUserProfile(profile);

  return {
    user: { id: jwtPayload.user_id, email: jwtPayload.email },
    profile: normalizedProfile,
  };
}

export async function requireCurrentUser(allowedRoles?: UserRole[]) {
  const context = await getCurrentUserContext();
  if (!context) {
    return { context: null, response: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  }

  if (allowedRoles?.length && !allowedRoles.includes(context.profile.role)) {
    return { context: null, response: NextResponse.json({ error: "Permission denied" }, { status: 403 }) };
  }

  return { context, response: null };
}

export function publicUserProfile(profile: UserProfile) {
  const normalizedProfile = normalizeUserProfile(profile);
  return {
    user_id: normalizedProfile.user_id,
    email: normalizedProfile.email,
    display_name: normalizedProfile.display_name,
    role: normalizedProfile.role,
    is_active: normalizedProfile.is_active,
  };
}
