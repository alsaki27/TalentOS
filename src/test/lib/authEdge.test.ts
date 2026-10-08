import { describe, expect, it } from "vitest";
import { canAccessPath, getDefaultRouteForRole, normalizeUserRole } from "@/lib/auth-edge";

describe("canAccessPath", () => {
  it("lets only admins into the /team management page and /api/users/<id> (role edits, deactivation)", () => {
    for (const role of ["manager", "application_engineer"]) {
      expect(canAccessPath(role, "/team")).toBe(false);
      expect(canAccessPath(role, "/team/invite")).toBe(false);
      expect(canAccessPath(role, "/api/users/some-id")).toBe(false);
    }
    expect(canAccessPath("admin", "/team")).toBe(true);
    expect(canAccessPath("admin", "/api/users/some-id")).toBe(true);
  });

  it("lets every authenticated role read the team list from GET /api/users - the assignment picker used by jobs, the application queue, inbox, and interview scheduling, not just /team", () => {
    // Regression guard: this exact path was previously swept into the /team
    // admin-only rule, which silently emptied every non-admin "owner" /
    // "assigned to" dropdown across the app (the route handler itself never
    // restricted GET - only POST, which still requires admin independently).
    expect(canAccessPath("manager", "/api/users")).toBe(true);
    expect(canAccessPath("application_engineer", "/api/users")).toBe(true);
    expect(canAccessPath("admin", "/api/users")).toBe(true);
  });

  it("keeps application_engineer out of the companies area, and everyone else in", () => {
    expect(canAccessPath("application_engineer", "/companies")).toBe(false);
    expect(canAccessPath("application_engineer", "/companies/123")).toBe(false);
    expect(canAccessPath("application_engineer", "/api/companies")).toBe(false);
    expect(canAccessPath("manager", "/companies")).toBe(true);
    expect(canAccessPath("admin", "/companies")).toBe(true);
  });

  it("allows any recognized role into ordinary areas like jobs", () => {
    for (const role of ["admin", "manager", "application_engineer"]) {
      expect(canAccessPath(role, "/jobs")).toBe(true);
      expect(canAccessPath(role, "/api/jobs/123")).toBe(true);
    }
  });

  it("normalizes an unrecognized or missing role to application_engineer before checking access", () => {
    expect(canAccessPath(null, "/team")).toBe(false);
    expect(canAccessPath("some-legacy-role", "/companies")).toBe(false);
    expect(normalizeUserRole(null)).toBe("application_engineer");
    expect(normalizeUserRole("recruiter")).toBe("manager");
    expect(normalizeUserRole("reviewer")).toBe("application_engineer");
  });
});

describe("getDefaultRouteForRole", () => {
  it("sends application engineers to candidates and everyone else to jobs", () => {
    expect(getDefaultRouteForRole("application_engineer")).toBe("/candidates");
    expect(getDefaultRouteForRole("manager")).toBe("/jobs");
    expect(getDefaultRouteForRole("admin")).toBe("/jobs");
  });
});
