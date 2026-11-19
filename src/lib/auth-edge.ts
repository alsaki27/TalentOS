// Authentication policy shared with Next.js Edge middleware.
//
// Keep this module dependency-free: importing the regular auth module from
// middleware also imports the PostgreSQL layer, and node-postgres cannot run in
// Next.js' Edge runtime.

export type UserRole = "admin" | "manager" | "application_engineer";
export type LegacyUserRole = UserRole | "recruiter" | "reviewer";
export type TeamRoleKey = UserRole
  | "co_manager"
  | "application_engineer_manager_reviewer"
  | "application_engineer_reviewer"
  | "application_engineer_grunter";

export interface TeamRoleDefinition {
  key: TeamRoleKey;
  label: string;
  accessRole: UserRole;
  roleVariant: string | null;
}

/**
 * Role titles are stored separately from their current access profile.
 * This keeps today's established permission checks intact while allowing
 * each sub-role to receive a distinct permission profile later.
 */
export const TEAM_ROLE_DEFINITIONS: Record<TeamRoleKey, TeamRoleDefinition> = {
  admin: { key: "admin", label: "Admin", accessRole: "admin", roleVariant: null },
  manager: { key: "manager", label: "Manager", accessRole: "manager", roleVariant: null },
  co_manager: { key: "co_manager", label: "Co-manager", accessRole: "manager", roleVariant: "co_manager" },
  application_engineer: { key: "application_engineer", label: "Application Engineer", accessRole: "application_engineer", roleVariant: null },
  application_engineer_manager_reviewer: {
    key: "application_engineer_manager_reviewer",
    label: "Application Engineer (Reviewer & Manager)",
    accessRole: "manager",
    roleVariant: "application_engineer_manager_reviewer",
  },
  application_engineer_reviewer: {
    key: "application_engineer_reviewer",
    label: "Application Engineer (Reviewer)",
    accessRole: "application_engineer",
    roleVariant: "application_engineer_reviewer",
  },
  application_engineer_grunter: {
    key: "application_engineer_grunter",
    label: "Application Engineer (Grunter)",
    accessRole: "application_engineer",
    roleVariant: "application_engineer_grunter",
  },
};

export const TEAM_ROLE_KEYS = Object.keys(TEAM_ROLE_DEFINITIONS) as TeamRoleKey[];

export function isTeamRoleKey(role: unknown): role is TeamRoleKey {
  return typeof role === "string" && Object.prototype.hasOwnProperty.call(TEAM_ROLE_DEFINITIONS, role);
}

export function getTeamRoleStorage(role: TeamRoleKey) {
  const definition = TEAM_ROLE_DEFINITIONS[role];
  return { role: definition.accessRole, role_variant: definition.roleVariant };
}

export function getEffectiveUserRole(role: string | null | undefined, roleVariant?: string | null): UserRole {
  if (roleVariant && isTeamRoleKey(roleVariant) && TEAM_ROLE_DEFINITIONS[roleVariant].roleVariant) {
    return TEAM_ROLE_DEFINITIONS[roleVariant].accessRole;
  }
  return normalizeUserRole(role);
}

export function getTeamRoleKey(role: string | null | undefined, roleVariant?: string | null): TeamRoleKey {
  if (roleVariant && isTeamRoleKey(roleVariant) && TEAM_ROLE_DEFINITIONS[roleVariant].roleVariant) return roleVariant;
  const normalized = normalizeUserRole(role);
  return normalized;
}

export const ALL_USER_ROLES: UserRole[] = ["admin", "manager", "application_engineer"];
// Review decisions are shared by staff; this does not grant access to
// scheduled-logging configuration or other master-data management.
export const CANDIDATE_JOB_REVIEW_ROLES: UserRole[] = ["admin", "manager", "application_engineer"];

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
  if (isTeamRoleKey(role)) return TEAM_ROLE_DEFINITIONS[role].label;
  return normalizeUserRole(role).replaceAll("_", " ");
}

export function getDefaultRouteForRole(role: string | null | undefined) {
  const normalizedRole = normalizeUserRole(role);
  if (normalizedRole === "application_engineer") return "/candidates";
  return "/jobs";
}

export function canAccessPath(role: string | null | undefined, pathname: string) {
  const normalizedRole = normalizeUserRole(role);
  // /api/users (exact path) is also the general "list active team members"
  // endpoint used for assignment/owner pickers across the app - jobs, the
  // application queue, inbox, interview scheduling - not just the /team
  // management page. Its own GET handler already allows any authenticated
  // role and only gates POST (create user) to admin; this blanket rule was
  // overriding that and blocking the picker for every non-admin role before
  // the route handler ever ran. /team itself and /api/users/<id> (role
  // edits, deactivation) are the actual admin-only team-management surface.
  const isTeamArea = pathname === "/team" || pathname.startsWith("/team/") || pathname.startsWith("/api/users/");
  const isApiKeyArea =
    pathname === "/settings/api-keys" || pathname.startsWith("/settings/api-keys/") ||
    pathname === "/api/api-keys" || pathname.startsWith("/api/api-keys/");
  const isJobsArea = pathname === "/jobs" || pathname.startsWith("/jobs/") || pathname === "/api/jobs" || pathname.startsWith("/api/jobs/");
  const isCompaniesArea =
    pathname === "/companies" ||
    pathname.startsWith("/companies/") ||
    pathname === "/api/companies" ||
    pathname.startsWith("/api/companies/");

  if (isTeamArea) return normalizedRole === "admin";
  if (isApiKeyArea) return normalizedRole === "admin";
  if (normalizedRole === "application_engineer" && isCompaniesArea) return false;
  return true;
}
