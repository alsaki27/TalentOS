import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export const ACCESS_TOKEN_COOKIE = "skarion_access_token";
export const REFRESH_TOKEN_COOKIE = "skarion_refresh_token";

export type UserRole = "admin" | "manager" | "application_engineer" | "recruiter" | "reviewer";

export interface UserProfile {
  user_id: string;
  email: string | null;
  display_name: string;
  role: UserRole;
  is_active: boolean;
}

export interface CurrentUserContext {
  user: User;
  profile: UserProfile;
}

export const ASSIGNMENT_MANAGER_ROLES: UserRole[] = ["admin", "manager", "recruiter"];
export const APPLICATION_WORKER_ROLES: UserRole[] = ["admin", "manager", "application_engineer", "recruiter"];
export const MASTER_DATA_MANAGER_ROLES: UserRole[] = ["admin", "manager", "recruiter"];
export const DESTRUCTIVE_MANAGER_ROLES: UserRole[] = ["admin", "manager"];
export const FALOOD_REVIEWER_ROLES: UserRole[] = ["admin", "manager", "reviewer"];

export function hasRole(profile: UserProfile, roles: UserRole[]) {
  return roles.includes(profile.role);
}

export async function getCurrentUserContext(): Promise<CurrentUserContext | null> {
  const token = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("user_id, email, display_name, role, is_active")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (profileError || !profile || !profile.is_active) return null;
  return { user: data.user, profile: profile as UserProfile };
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
  return {
    user_id: profile.user_id,
    email: profile.email,
    display_name: profile.display_name,
    role: profile.role,
  };
}
