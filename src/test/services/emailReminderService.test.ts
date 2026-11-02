import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn(), execute: vi.fn(), requireCurrentUser: vi.fn() }));
vi.mock("@/server/db/neon", () => ({ query: mocks.query, queryOne: mocks.queryOne, execute: mocks.execute }));
vi.mock("@/lib/auth", () => ({ ALL_USER_ROLES: ["admin", "ae", "recruiter"], requireCurrentUser: mocks.requireCurrentUser }));

import { loadEmailReminderSnapshot } from "@/server/services/emailReminderService";
import { renderEmailReminderDigest } from "@/server/services/emailReminderDigest";
import { GET as getReminderRoute } from "@/app/api/inbox/reminders/route";
import { PUT as updateRecipients } from "@/app/api/inbox/reminders/recipients/route";
import { NextRequest } from "next/server";

const context = { profile: { user_id: "user-1", role: "admin" } };

const message = {
  id: "e14b8b16-73f7-4d47-b446-2cf74fa8a49a",
  candidate_id: "a6e6e290-1e38-4b17-b785-f04dd11ba028",
  candidate_name: "A Candidate", candidate_email: "candidate@example.com",
  from_email: "recruiter@example.com", subject: "Interview details",
  snippet: "Please confirm a time", sent_at: "2026-11-02T04:00:00.000Z", ai_category: "scheduling",
  ai_summary: "The recruiter asks to confirm a time.", ai_matched_application_id: null,
  needs_reply: true, replied_at: null, manual_reply: false, response_due_at: "2026-11-03T04:00:00.000Z",
  job_id: null, job_title: null, company_name: null, received_in_window: false,
  replied_in_window: false, overdue_24h: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireCurrentUser.mockResolvedValue({ context, response: null });
  mocks.execute.mockResolvedValue({ rowCount: 1 });
  mocks.queryOne
    .mockResolvedValueOnce({ needs_reply: 7, waiting_12h: 2, overdue_24h: 1, replied_12h: 3 })
    .mockResolvedValueOnce({ total: 1 })
    .mockResolvedValueOnce({ total: 1 });
  mocks.query
    .mockResolvedValueOnce([{ candidate_id: message.candidate_id, candidate_name: message.candidate_name, needs_reply: 1, waiting_12h: 0, overdue_24h: 0, replied_12h: 0 }])
    .mockResolvedValueOnce([message]);
});

describe("email reminder metrics and digest", () => {
  it("returns only the four operational reply metrics and paginates both lists", async () => {
    const snapshot = await loadEmailReminderSnapshot({
      windowStart: new Date("2026-11-01T20:00:00.000Z"),
      windowEnd: new Date("2026-11-02T08:00:00.000Z"),
      scope: "needs-reply", messagePage: 2, messagePageSize: 20, candidatePage: 3, candidatePageSize: 20,
      category: "scheduling", candidateId: message.candidate_id, search: "recruiter",
    });

    expect(snapshot.summary).toEqual({ needs_reply: 7, waiting_12h: 2, overdue_24h: 1, replied_12h: 3 });
    expect(snapshot.messagePage).toBe(2);
    expect(snapshot.messagePageSize).toBe(20);
    expect(snapshot.candidateActivityPage).toBe(3);
    const sql = mocks.query.mock.calls.map(([statement]: [string]) => statement).join("\n");
    expect(sql).toContain("manual_replied_at");
    expect(sql).toContain("interval '7 days'");
    expect(sql).toContain("j.title ILIKE");
    expect(sql).toContain("j.company ILIKE");
    expect(sql).toContain("LIMIT $7 OFFSET $8");
    const summaryCall = mocks.queryOne.mock.calls[0];
    const countCall = mocks.queryOne.mock.calls[2];
    const messagesCall = mocks.query.mock.calls[1];
    expect(summaryCall[0]).toContain("ii.ai_category = $4");
    expect(summaryCall[0]).toContain("ii.candidate_id = $5::uuid");
    expect(summaryCall[0]).toContain("j.title ILIKE $6");
    expect(summaryCall[1]).toEqual([
      expect.any(String), expect.any(String), expect.any(Array), "scheduling", message.candidate_id, "%recruiter%",
    ]);
    expect(countCall[1]).toHaveLength(6);
    expect(messagesCall[1]).toHaveLength(8);
    expect(messagesCall[0]).not.toContain("ii.gmail_thread_id");
  });

  it("shows a compact four-count digest with a direct email and candidate link", () => {
    const waitingMessage = { ...message, sent_at: "2026-11-01T19:00:00.000Z" };
    const recentMessage = { ...message, id: "recent-under-12h", sent_at: "2026-11-02T06:00:00.000Z" };
    const oldMessage = { ...message, id: "old-over-7d", sent_at: "2026-10-25T19:00:00.000Z" };
    const snapshot = {
      summary: { needs_reply: 7, waiting_12h: 2, overdue_24h: 1, replied_12h: 3 },
      messages: [waitingMessage, recentMessage, oldMessage], candidates: [], candidateActivityTotal: 0, candidateActivityPage: 1,
      candidateActivityPageSize: 20, messageTotal: 1, messagePage: 1, messagePageSize: 20, focusMessage: null,
    } as any;
    const html = renderEmailReminderDigest(snapshot, new Date("2026-11-01T20:00:00Z"), new Date("2026-11-02T08:00:00Z"), "http://localhost:3000");

    expect(html).toContain("Waiting 12–24 hours");
    expect(html).toContain("Overdue 24+ hours");
    expect(html).toContain("emailId=" + waitingMessage.id);
    expect(html).toContain("candidateId=" + waitingMessage.candidate_id);
    expect(html).not.toContain("emailId=recent-under-12h");
    expect(html).not.toContain("emailId=old-over-7d");
    expect(html).not.toContain("Replies completed · last 12 hours");
    expect(html).not.toContain("Not opened");
    expect(html).not.toContain("Solved");
  });

  it("loads a filtered, paginated reminder request without dropping query parameters", async () => {
    const request = new NextRequest(`https://talentos.test/api/inbox/reminders?scope=overdue&category=scheduling&candidateId=${message.candidate_id}&search=recruiter&page=2&pageSize=10&candidatePage=3&candidatePageSize=5`);
    const response = await getReminderRoute(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.messagePage).toBe(2);
    expect(body.messagePageSize).toBe(10);
    expect(body.candidateActivityPage).toBe(3);
    expect(mocks.queryOne.mock.calls[2][0]).toContain("ii.sent_at < $2::timestamptz - interval '24 hours'");
    expect(mocks.queryOne.mock.calls[2][0]).toContain("ii.sent_at >= $2::timestamptz - interval '7 days'");
    expect(mocks.queryOne.mock.calls[2][1]).toEqual([
      expect.any(String), expect.any(String), expect.any(Array), "scheduling", message.candidate_id, "%recruiter%",
    ]);
    expect(mocks.query.mock.calls[1][1]).toHaveLength(8);
  });

  it("accepts each reminder scope used by the filter and metric buttons", async () => {
    for (const scope of ["recent", "needs-reply", "waiting-12h", "overdue", "replied", "no-reply-needed", "all"]) {
      vi.clearAllMocks();
      mocks.requireCurrentUser.mockResolvedValue({ context, response: null });
      mocks.queryOne.mockResolvedValue({ total: 0 });
      mocks.query.mockResolvedValue([]);
      const response = await getReminderRoute(new NextRequest(`https://talentos.test/api/inbox/reminders?scope=${scope}`));
      expect(response.status, `scope=${scope}`).toBe(200);
    }
  });

  it("returns JSON when the reminder database query fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.queryOne.mockReset().mockRejectedValueOnce(new Error("database unavailable")).mockResolvedValue({ total: 0 });
    mocks.query.mockReset().mockResolvedValue([]);
    const response = await getReminderRoute(new NextRequest("https://talentos.test/api/inbox/reminders?scope=needs-reply"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Could not load email reminders. Check the server log for details." });
    vi.restoreAllMocks();
  });

  it("saves normalized reminder recipients and rejects invalid addresses", async () => {
    const valid = await updateRecipients(new NextRequest("https://talentos.test/api/inbox/reminders/recipients", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ recipients: ["  SHOHANHYDER@GMAIL.COM "] }),
    }));
    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual({ ok: true, recipients: ["shohanhyder@gmail.com"] });
    expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO email_reminder_recipients"), [["shohanhyder@gmail.com"], "user-1"]);

    const invalid = await updateRecipients(new NextRequest("https://talentos.test/api/inbox/reminders/recipients", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ recipients: ["not-an-email"] }),
    }));
    expect(invalid.status).toBe(400);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
});
