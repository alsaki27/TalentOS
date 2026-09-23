// Authentication policy shared with Next.js Edge middleware.
//
// Keep this module dependency-free: importing the regular auth module from
// middleware also imports the PostgreSQL layer, and node-postgres cannot run in
// Next.js' Edge runtime.

export type UserRole = "admin" | "manager" | "application_engineer";
export type LegacyUserRole = UserRole | "recruiter" | "reviewer";

export const ALL_USER_ROLES: UserRole[] = ["admin", "manager", "application_engineer"];

function isUserRole(role: string): role is UserRole {
  return ALL_USER_ROLES.includes(role as UserRole);
}

export function normalizeUserRole(role: string | null | undefined): UserRole {
  if (!role) return "application_engineer";
  if (isUserRole(role)) return role;
  if (role === "recruiter") return "manager";
  if (role === "reviewer") return "application_engineer";
  return "application_engineer";
}

export function getRoleLabel(role: string) {
  return normalizeUserRole(role).replaceAll("_", " ");
}

export function getDefaultRouteForRole(role: string | null | undefined) {
  const normalizedRole = normalizeUserRole(role);
  if (normalizedRole === "application_engineer") return "/candidates";
  return "/jobs";
}

export function canAccessPath(role: string | null | undefined, pathname: string) {
  const normalizedRole = normalizeUserRole(role);
  const isTeamArea = pathname === "/team" || pathname.startsWith("/team/") || pathname === "/api/users" || pathname.startsWith("/api/users/");
  const isJobsArea = pathname === "/jobs" || pathname.startsWith("/jobs/") || pathname === "/api/jobs" || pathname.startsWith("/api/jobs/");
  const isCompaniesArea =
    pathname === "/companies" ||
    pathname.startsWith("/companies/") ||
    pathname === "/api/companies" ||
    pathname.startsWith("/api/companies/");

  if (isTeamArea) return normalizedRole === "admin";
  if (normalizedRole === "application_engineer" && isCompaniesArea) return false;
  return true;
}
