import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  loadEmailReminderSnapshot: vi.fn(),
  isGraphMailConfigured: vi.fn(),
  sendOperationalEmail: vi.fn(),
  renderEmailReminderDigest: vi.fn(),
}));

vi.mock("@/server/db/neon", () => ({ query: mocks.query, queryOne: mocks.queryOne, execute: mocks.execute }));
vi.mock("@/server/services/emailReminderService", () => ({ loadEmailReminderSnapshot: mocks.loadEmailReminderSnapshot }));
vi.mock("@/lib/msGraphMail", () => ({ isGraphMailConfigured: mocks.isGraphMailConfigured }));
vi.mock("@/lib/operationalEmail", () => ({ sendOperationalEmail: mocks.sendOperationalEmail }));
vi.mock("@/server/services/emailReminderDigest", () => ({ renderEmailReminderDigest: mocks.renderEmailReminderDigest }));

import { POST } from "@/app/api/cron/email-reminders/route";
import { NextRequest } from "next/server";

const slot = "2026-11-02T20:00+06:00";
const candidateId = "a6e6e290-1e38-4b17-b785-f04dd11ba028";
const makeMessage = (id: string, sent_at: string, replied_at: string | null = null) => ({
  id,
  candidate_id: candidateId,
  candidate_name: "A Candidate",
  subject: `Subject ${id}`,
  sent_at,
  needs_reply: true,
  replied_at,
});

describe("scheduled email reminder notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "test-secret");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    mocks.query.mockImplementation((sql: string) => sql.includes("FROM profiles WHERE is_active")
      ? [{ user_id: "staff-1" }, { user_id: "staff-2" }]
      : []);
    mocks.queryOne.mockResolvedValue({ slot_key: slot });
    mocks.execute.mockImplementation(() => ({ rowCount: 1 }));
    mocks.isGraphMailConfigured.mockReturnValue(false);
    mocks.sendOperationalEmail.mockResolvedValue({ success: true });
    mocks.renderEmailReminderDigest.mockReturnValue("<html></html>");
    mocks.loadEmailReminderSnapshot.mockResolvedValue({
      messages: [
        makeMessage("00000000-0000-0000-0000-000000000012", "2026-11-02T00:00:00.000Z"), // 14 hours
        makeMessage("00000000-0000-0000-0000-000000000024", "2026-11-01T11:00:00.000Z"), // 27 hours
        makeMessage("00000000-0000-0000-0000-000000000168", "2026-10-26T14:00:00.000Z"), // 7 days, retained
        makeMessage("00000000-0000-0000-0000-000000000170", "2026-10-26T12:00:00.000Z"), // beyond 7 days
        makeMessage("00000000-0000-0000-0000-000000000010", "2026-11-02T04:00:00.000Z"), // 10 hours
        makeMessage("00000000-0000-0000-0000-000000000030", "2026-11-01T08:00:00.000Z", "2026-11-02T10:00:00.000Z"), // replied
      ],
      messageTotal: 6,
      summary: { needs_reply: 5, waiting_12h: 1, overdue_24h: 2, replied_12h: 1 },
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("creates one grouped notification per reply-age bucket for every active staff member", async () => {
    const response = await POST(new NextRequest(`https://talentos.test/api/cron/email-reminders?slot=${encodeURIComponent(slot)}`, {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
    }));
    const body = await response.json();

    expect(response.status).toBe(500); // no digest recipients in this test fixture
    expect(body.reason).toBe("no_recipients");
    expect(body.notifications).toEqual({ staffCount: 2, emailCount: 3, notificationCount: 4 });

    const groupedInserts = mocks.execute.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO notifications"));
    expect(groupedInserts).toHaveLength(2);
    expect(groupedInserts.map(([, params]) => params.slice(0, 2))).toEqual(expect.arrayContaining([
      ["email_reply_waiting", "Reply waiting · 12–24 hours"],
      ["email_reply_overdue", "Reply overdue · 24+ hours"],
    ]));
    for (const [sql, params] of groupedInserts) {
      expect(String(sql)).toContain("email_reminder_digest");
      expect(params[3]).toMatch(/^\/inbox\/reminders\?scope=(waiting-12h|overdue)$/);
      expect(params[3]).not.toContain("emailId=");
      expect(params[3]).not.toContain("candidateId=");
    }
    expect(mocks.execute.mock.calls.some(([sql]) => String(sql).includes("DELETE FROM notifications"))).toBe(true);
    expect(mocks.sendOperationalEmail).not.toHaveBeenCalled();
  });

  it("marks a grouped bucket read when it has no qualifying mail", async () => {
    mocks.loadEmailReminderSnapshot.mockResolvedValue({
      messages: [makeMessage("00000000-0000-0000-0000-000000000010", "2026-11-02T04:00:00.000Z")],
      messageTotal: 1,
      summary: { needs_reply: 1, waiting_12h: 0, overdue_24h: 0, replied_12h: 0 },
    });
    await POST(new NextRequest(`https://talentos.test/api/cron/email-reminders?slot=${encodeURIComponent(slot)}`, {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
    }));

    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining("entity_type = 'email_reminder_digest' AND type = $1"),
      ["email_reply_waiting"],
    );
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining("entity_type = 'email_reminder_digest' AND type = $1"),
      ["email_reply_overdue"],
    );
    expect(mocks.execute.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO notifications"))).toBe(false);
  });
});
