import { describe, expect, it } from "vitest";
import { matchesTeamMemberFilters, type TeamMemberFilters } from "@/lib/teamMemberFilters";

const filters: TeamMemberFilters = { search: "", roleGroup: "all", status: "all" };

describe("matchesTeamMemberFilters", () => {
  const members = [
    { display_name: "Sareta Ridwana", email: "sareta@example.com", role: "manager", role_key: "application_engineer_manager_reviewer", is_active: true },
    { display_name: "Tafhim", email: "tafhim@example.com", role: "application_engineer", role_key: "application_engineer_grunter", is_active: true },
    { display_name: "Co-manager", email: "co@example.com", role: "manager", role_key: "co_manager", is_active: false },
    { display_name: "Admin One", email: "admin@example.com", role: "admin", role_key: "admin", is_active: true },
  ];

  it("combines a normalized name search, role access group, and active status", () => {
    expect(matchesTeamMemberFilters(members[0], { search: "sareta", roleGroup: "manager", status: "active" })).toBe(true);
    expect(matchesTeamMemberFilters(members[1], { search: "sareta", roleGroup: "application_engineer", status: "active" })).toBe(false);
  });

  it("groups sub-roles by their effective access profile", () => {
    expect(members.filter((member) => matchesTeamMemberFilters(member, { ...filters, roleGroup: "manager" })))
      .toEqual([members[0], members[2]]);
    expect(members.filter((member) => matchesTeamMemberFilters(member, { ...filters, roleGroup: "application_engineer" })))
      .toEqual([members[1]]);
  });

  it("filters active and inactive independently and supports legacy role payloads", () => {
    expect(matchesTeamMemberFilters(members[2], { ...filters, status: "inactive" })).toBe(true);
    expect(matchesTeamMemberFilters({ display_name: "Legacy AE", role: "application_engineer", is_active: true }, {
      ...filters, roleGroup: "application_engineer", status: "active",
    })).toBe(true);
    expect(matchesTeamMemberFilters(members[2], { ...filters, status: "active" })).toBe(false);
  });
});
