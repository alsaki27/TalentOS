import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireCurrentUser: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireCurrentUser: mocks.requireCurrentUser }));
vi.mock("@/server/db/neon", () => ({ query: mocks.query }));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/admin/extension-reports/route";

describe("admin team activity report API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCurrentUser.mockResolvedValue({ response: null });
  });

  it("includes the full team, limits the report to 30 days, and filters by team member", async () => {
    mocks.query
      .mockResolvedValueOnce([
        { user_id: "member-1", display_name: "Test Manager", email: "manager@example.com", role: "manager", is_active: true },
        { user_id: "member-2", display_name: "Test Recruiter", email: "recruiter@example.com", role: "recruiter", is_active: true },
      ])
      .mockResolvedValueOnce([{
        actor_user_id: "member-1", display_name: "Test Manager", email: "manager@example.com", period: "2026-10-12",
        jobs_added: 2, duplicate_captures: 1, candidates_logged: 3, resumes_edited: 1,
        applications_reviewed: 2, applications_applied: 1,
      }])
      .mockResolvedValueOnce([]);

    const response = await GET(new NextRequest("https://talentos.test/api/admin/extension-reports?days=90&group=week&memberId=member-1"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ days: 30, group: "week", timezone: "Asia/Dhaka", teamMembers: [
      { user_id: "member-1", role: "manager" }, { user_id: "member-2", role: "recruiter" },
    ], totals: {
      job_added: 2, job_duplicate: 1, candidate_logged: 3, resume_edited: 1,
      application_reviewed: 2, application_applied: 1,
    } });
    expect(String(mocks.query.mock.calls[0][0])).toContain("FROM profiles");
    expect(String(mocks.query.mock.calls[0][0])).not.toContain("role = 'application_engineer'");
    expect(mocks.query).toHaveBeenNthCalledWith(2, expect.stringContaining("date_trunc($2"), [30, "week", "member-1"]);
  });

  it("rejects invalid grouping and returns admin authorization responses without querying data", async () => {
    const invalid = await GET(new NextRequest("https://talentos.test/api/admin/extension-reports?group=hour"));
    expect(invalid.status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();

    const forbidden = Response.json({ error: "Permission denied" }, { status: 403 });
    mocks.requireCurrentUser.mockResolvedValueOnce({ response: forbidden });
    const denied = await GET(new NextRequest("https://talentos.test/api/admin/extension-reports"));
    expect(denied.status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
