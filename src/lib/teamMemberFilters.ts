import { TEAM_ROLE_DEFINITIONS, getTeamRoleKey, type TeamRoleKey } from "@/lib/auth-edge";

export type TeamRoleGroupFilter = "all" | "admin" | "manager" | "application_engineer";
export type TeamStatusFilter = "all" | "active" | "inactive";

export interface TeamMemberFilterInput {
  display_name?: string | null;
  email?: string | null;
  role?: string | null;
  role_key?: string | null;
  is_active: boolean;
}

export interface TeamMemberFilters {
  search: string;
  roleGroup: TeamRoleGroupFilter;
  status: TeamStatusFilter;
}

function normalizeSearchText(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
}

export function teamMemberRoleKey(member: Pick<TeamMemberFilterInput, "role" | "role_key">): TeamRoleKey {
  const roleKey = member.role_key;
  if (roleKey && Object.prototype.hasOwnProperty.call(TEAM_ROLE_DEFINITIONS, roleKey)) {
    return roleKey as TeamRoleKey;
  }
  return getTeamRoleKey(member.role);
}

export function matchesTeamMemberFilters(member: TeamMemberFilterInput, filters: TeamMemberFilters) {
  const roleKey = teamMemberRoleKey(member);
  const definition = TEAM_ROLE_DEFINITIONS[roleKey];
  const query = normalizeSearchText(filters.search);
  const searchMatch = !query || normalizeSearchText(`${member.display_name ?? ""} ${member.email ?? ""}`).includes(query);
  const roleMatch = filters.roleGroup === "all" || definition.accessRole === filters.roleGroup;
  const statusMatch = filters.status === "all"
    || (filters.status === "active" ? member.is_active : !member.is_active);
  return searchMatch && roleMatch && statusMatch;
}
