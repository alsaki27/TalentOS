import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/neon", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import { buildCandidatePortalDashboardPage, getCandidatePortalApplicationDetail, getCandidatePortalInterviews } from "@/lib/candidatePortalDashboardService";
import { query, queryOne } from "@/server/db/neon";

describe("candidate portal read model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (query as any).mockResolvedValue([]);
    (queryOne as any).mockResolvedValue({ count: "0" });
  });

  it("scopes the application list to the authenticated candidate and excludes internal pipeline rows", async () => {
    await buildCandidatePortalDashboardPage("candidate-a", "Avirup", {
      search: "GIS",
      dateRange: "custom",
      dateFrom: "2026-08-01",
      dateTo: "2026-08-10",
      interviewStatus: "upcoming",
      needsAttention: true,
    });

    const sqlCalls = [
      ...(query as any).mock.calls,
      ...(queryOne as any).mock.calls,
    ].map((call: any[]) => call[0] as string);
    const listSql = sqlCalls.find((sql) => sql.includes("SELECT * FROM candidate_apps"));
    expect(listSql).toContain("a.candidate_id = $1");
    expect(listSql).toContain("NOT IN ('assigned', 'stacked', 'in_progress')");
    expect(listSql).toContain("interview_status = $3");
    expect(listSql).toContain("needs_attention = TRUE");

    const listCall = (query as any).mock.calls.find((call: any[]) => String(call[0]).includes("SELECT * FROM candidate_apps"));
    expect(listCall[1][0]).toBe("candidate-a");
    expect(listCall[1]).toContain("%GIS%");
    expect(listCall[1]).toContain("2026-08-01T00:00:00.000Z");
    expect(listCall[1]).toContain("2026-08-10T23:59:59.999Z");
  });

  it("requires candidate ownership in the detail query", async () => {
    (queryOne as any).mockResolvedValue(null);

    const result = await getCandidatePortalApplicationDetail("candidate-b", "application-a");

    expect(result).toBeNull();
    const [sql, params] = (queryOne as any).mock.calls[0];
    expect(sql).toContain("a.id = $1");
    expect(sql).toContain("a.candidate_id = $2");
    expect(sql).toContain("NOT IN ('assigned', 'stacked', 'in_progress')");
    expect(sql).toContain("rv.application_id = a.id");
    expect(sql).toContain("rv.candidate_id = a.candidate_id");
    expect(sql).toContain("packet.packet_status IN ('approved', 'sent')");
    expect(params).toEqual(["application-a", "candidate-b"]);
    expect(query).not.toHaveBeenCalled();
  });

  it("carries each interview's saved timezone into the application progress timeline", async () => {
    (queryOne as any).mockResolvedValueOnce({ id: "application-a", status: "interview", submitted_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-02T00:00:00.000Z", job_id: "job-a", job_title: "Analyst", company_name: "Acme" });
    (query as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "interview-chicago", round_name: "Interview", round_number: 1, scheduled_at: "2099-08-12T15:00:00.000Z", time_zone: "America/Chicago", duration_minutes: 45, status: "scheduled", interview_format: "online", location: null, meeting_link: null, panel: [] },
        { id: "interview-legacy", round_name: "Screen", round_number: 2, scheduled_at: "2099-08-13T15:00:00.000Z", time_zone: null, duration_minutes: null, status: "scheduled", interview_format: null, location: null, meeting_link: null, panel: [] },
      ])
      .mockResolvedValueOnce([]);

    const result = await getCandidatePortalApplicationDetail("candidate-a", "application-a");

    const chicago = result!.timeline.find((event) => event.id === "interview:interview-chicago");
    const legacy = result!.timeline.find((event) => event.id === "interview:interview-legacy");
    expect(chicago?.time_zone).toBe("America/Chicago");
    expect(legacy?.time_zone).toBe("America/New_York");
    expect(result!.interviews.map((interview) => interview.time_zone)).toEqual(["America/Chicago", "America/New_York"]);
  });

  it("scopes the interview center and only includes candidate-visible updates", async () => {
    (query as any).mockResolvedValueOnce([{ id: "interview-a", application_id: "application-a", scheduled_at: "2099-08-12T15:00:00.000Z", status: "scheduled", panel: ["Recruiter"], visible_updates: [] }]);
    const result = await getCandidatePortalInterviews("candidate-a");

    expect(result[0].status).toBe("upcoming");
    const [sql, params] = (query as any).mock.calls[0];
    expect(sql).toContain("a.candidate_id = $1");
    expect(sql).toContain("c.visible_to_candidate = true");
    expect(sql).toContain("NOT IN ('assigned', 'stacked', 'in_progress')");
    expect(params).toEqual(["candidate-a"]);
  });
});
