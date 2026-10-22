import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  isGraphMailConfigured: vi.fn(),
  sendGraphMail: vi.fn(),
}));

vi.mock("@/server/db/neon", () => ({ query: mocks.query }));
vi.mock("@/lib/msGraphMail", () => ({
  isGraphMailConfigured: mocks.isGraphMailConfigured,
  sendGraphMail: mocks.sendGraphMail,
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/cron/team-activity-report/route";
import {
  getTeamActivityReportRecipients,
  getTeamActivityReportWindow,
  renderTeamActivityEmail,
  type TeamActivityMember,
} from "@/lib/teamActivityEmailReport";

const member: TeamActivityMember = {
  actor_user_id: "member-1",
  display_name: "AE <One>",
  email: "ae@example.com",
  role: "application_engineer",
  is_active: true,
  jobs_added: 2,
  duplicate_captures: 1,
  candidates_logged: 3,
  applications_reviewed: 4,
  applications_applied: 1,
};

function makeRequest(period = "daily", authorized = true) {
  return new NextRequest(`https://talentos.test/api/cron/team-activity-report?period=${period}`, {
    method: "POST",
    headers: authorized ? { authorization: "Bearer test-cron-secret" } : {},
  });
}

describe("team activity report email helpers", () => {
  it("uses Eastern calendar boundaries across the daylight-saving transition", () => {
    const daily = getTeamActivityReportWindow("daily", new Date("2026-10-23T21:00:00.000Z"));
    expect(daily.startAt.toISOString()).toBe("2026-10-23T04:00:00.000Z");
    expect(daily.label).toBe("Oct 23, 2026 · 12:00 AM–5:00 PM EDT");

    const weekly = getTeamActivityReportWindow("weekly", new Date("2026-11-01T22:00:00.000Z"));
    expect(weekly.startAt.toISOString()).toBe("2026-10-25T21:00:00.000Z");
    expect(weekly.endAt.toISOString()).toBe("2026-11-01T22:00:00.000Z");
    expect(weekly.label).toContain("EDT");
    expect(weekly.label).toContain("EST");
  });

  it("parses, validates, and deduplicates deployment-configured recipients", () => {
    expect(getTeamActivityReportRecipients("one@example.com; TWO@example.com,one@example.com\ninvalid"))
      .toEqual(["one@example.com", "two@example.com"]);
  });

  it("renders a branded report while escaping team-provided text", () => {
    const window = getTeamActivityReportWindow("daily", new Date("2026-10-23T21:00:00.000Z"));
    const html = renderTeamActivityEmail({
      period: "daily",
      window,
      members: [member],
      reportUrl: "https://talent.skarion.com/admin/extension-reports",
    });

    expect(html).toContain("https://www.skarion.com/logo.svg");
    expect(html).toContain("Daily team activity");
    expect(html).toContain("11 actions");
    expect(html).toContain("AE &lt;One&gt;");
    expect(html).not.toContain("AE <One>");
    expect(html).toContain("Open TalentOS activity report");
  });
});

describe("team activity report cron endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
    vi.stubEnv("TEAM_ACTIVITY_REPORT_RECIPIENTS", "shohanhyder@gmail.com");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    mocks.isGraphMailConfigured.mockReturnValue(true);
    mocks.sendGraphMail.mockResolvedValue({ success: true });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("sends one report to the configured recipient using read-only activity queries", async () => {
    mocks.query
      .mockResolvedValueOnce([{
        user_id: "member-1", display_name: "AE One", email: "ae@example.com",
        role: "application_engineer", is_active: true,
      }])
      .mockResolvedValueOnce([{
        actor_user_id: "member-1", display_name: "AE One", email: "ae@example.com",
        role: "application_engineer", is_active: true, jobs_added: 2, duplicate_captures: 1,
        candidates_logged: 3, applications_reviewed: 4, applications_applied: 1,
      }]);

    const response = await POST(makeRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      period: "daily",
      recipientCount: 1,
      totals: {
        jobs_added: 2,
        duplicate_captures: 1,
        candidates_logged: 3,
        applications_reviewed: 4,
        applications_applied: 1,
      },
    });
    expect(mocks.query).toHaveBeenCalledTimes(2);
    for (const [sql] of mocks.query.mock.calls) {
      expect(String(sql)).toMatch(/^\s*SELECT/i);
      expect(String(sql)).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
    }
    expect(mocks.sendGraphMail).toHaveBeenCalledWith(expect.objectContaining({
      to: "shohanhyder@gmail.com",
      subject: expect.stringContaining("Daily Team Activity Report"),
      html: expect.stringContaining("Open TalentOS activity report"),
    }));
  });

  it("rejects unauthorized or invalid requests without querying or sending", async () => {
    const unauthorized = await POST(makeRequest("daily", false));
    expect(unauthorized.status).toBe(401);

    const invalidPeriod = await POST(makeRequest("monthly"));
    expect(invalidPeriod.status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.sendGraphMail).not.toHaveBeenCalled();
  });

  it("fails clearly when recipients are not configured", async () => {
    vi.stubEnv("TEAM_ACTIVITY_REPORT_RECIPIENTS", "");
    const response = await POST(makeRequest());
    expect(response.status).toBe(503);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.sendGraphMail).not.toHaveBeenCalled();
  });

  it("reports provider failures without claiming that the report was sent", async () => {
    mocks.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mocks.sendGraphMail.mockResolvedValue({ success: false, error: "provider rejected message" });

    const response = await POST(makeRequest());
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "One or more report emails could not be sent.", sent: 0, failed: 1 });
  });
});
