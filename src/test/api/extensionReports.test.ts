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

  it("includes the full team and applies date, member, candidate, action, and pagination filters", async () => {
    mocks.query
      .mockResolvedValueOnce([
        { user_id: "member-1", display_name: "Test Manager", email: "manager@example.com", role: "manager", is_active: true },
        { user_id: "member-2", display_name: "Test Recruiter", email: "recruiter@example.com", role: "recruiter", is_active: true },
      ])
      .mockResolvedValueOnce([{ candidate_id: "candidate-1", candidate_name: "Test Candidate" }])
      .mockResolvedValueOnce([{
        actor_user_id: "member-1", display_name: "Test Manager", email: "manager@example.com",
        jobs_added: 2, duplicate_captures: 1, candidates_logged: 3,
        applications_reviewed: 2, applications_applied: 1,
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: 62 }])
      .mockResolvedValueOnce([]);

    const response = await GET(new NextRequest("https://talentos.test/api/admin/extension-reports?startAt=2026-10-21T00%3A00&endAt=2026-10-22T00%3A00&memberId=member-1&candidateId=candidate-1&eventType=application_reviewed&page=2&pageSize=50"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ timezone: "Asia/Dhaka", range: { startAt: "2026-10-21T00:00", endAt: "2026-10-22T00:00" }, teamMembers: [
      { user_id: "member-1", role: "manager" }, { user_id: "member-2", role: "recruiter" },
    ], candidates: [{ candidate_id: "candidate-1", candidate_name: "Test Candidate" }], totals: {
      job_added: 2, job_duplicate: 1, candidate_logged: 3,
      application_reviewed: 2, application_applied: 1,
    }, pagination: { page: 2, pageSize: 50, total: 62, totalPages: 2 } });
    expect(String(mocks.query.mock.calls[0][0])).toContain("FROM profiles");
    expect(String(mocks.query.mock.calls[0][0])).not.toContain("role = 'application_engineer'");
    expect(mocks.query).toHaveBeenNthCalledWith(3, expect.stringContaining("candidate_id::text = $4::text"), [
      "2026-10-21T00:00", "2026-10-22T00:00", "member-1", "candidate-1", "application_reviewed",
    ]);
    expect(mocks.query).toHaveBeenNthCalledWith(4, expect.stringContaining("AS period"), [
      "2026-10-21T00:00", "2026-10-22T00:00", "member-1", "candidate-1", "application_reviewed",
    ]);
    expect(mocks.query).toHaveBeenNthCalledWith(6, expect.stringContaining("LIMIT $6 OFFSET $7"), [
      "2026-10-21T00:00", "2026-10-22T00:00", "member-1", "candidate-1", "application_reviewed", 50, 50,
    ]);
  });

  it("rejects invalid filters and returns admin authorization responses without querying data", async () => {
    const invalid = await GET(new NextRequest("https://talentos.test/api/admin/extension-reports?startAt=not-a-date"));
    expect(invalid.status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();

    const forbidden = Response.json({ error: "Permission denied" }, { status: 403 });
    mocks.requireCurrentUser.mockResolvedValueOnce({ response: forbidden });
    const denied = await GET(new NextRequest("https://talentos.test/api/admin/extension-reports"));
    expect(denied.status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
