import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  ALL_USER_ROLES: ["admin", "ae", "recruiter"],
  requireCurrentUser: mocks.requireCurrentUser,
}));
vi.mock("@/server/db/neon", () => ({
  query: mocks.query,
  queryOne: mocks.queryOne,
  execute: mocks.execute,
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/gmail-communications/route";
import { POST as saveFeedback } from "@/app/api/gmail-communications/[id]/feedback/route";

const context = { profile: { user_id: "user-1" } };
const emailParams = { params: { id: "email-1" } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireCurrentUser.mockResolvedValue({ context, response: null });
  mocks.query.mockResolvedValue([]);
  mocks.queryOne.mockResolvedValue({ total: "0" });
  mocks.execute.mockResolvedValue({ rowCount: 1 });
});

describe("candidate email reply and resolution workflow", () => {
  it("keeps synced and manually recorded replies in the Team replied inbox filter", async () => {
    const response = await GET(new NextRequest("https://talentos.test/api/gmail-communications?direction=inbox&replyStatus=replied"));

    expect(response.status).toBe(200);
    const sqlCalls = [
      ...mocks.queryOne.mock.calls.map(([sql]: [string]) => sql),
      ...mocks.query.mock.calls.map(([sql]: [string]) => sql),
    ];
    expect(sqlCalls.some((sql) => sql.includes("ec.direction = 'inbound' AND (public.email_detected_team_reply_at(ec.id) IS NOT NULL OR ec.replied_at IS NOT NULL OR ec.manual_replied_at IS NOT NULL)"))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes("email_thread_user_state"))).toBe(false);
  });

  it("excludes replies from needs-reply, waiting, and overdue filters without opened/checked state", async () => {
    for (const replyStatus of ["needs-reply", "waiting-12h", "overdue-24h"]) {
      vi.clearAllMocks();
      mocks.requireCurrentUser.mockResolvedValue({ context, response: null });
      mocks.query.mockResolvedValue([]);
      mocks.queryOne.mockResolvedValue({ total: "0" });

      const response = await GET(new NextRequest(`https://talentos.test/api/gmail-communications?direction=inbox&replyStatus=${replyStatus}`));
      expect(response.status).toBe(200);
      const sqlCalls = [
        ...mocks.queryOne.mock.calls.map(([sql]: [string]) => sql),
        ...mocks.query.mock.calls.map(([sql]: [string]) => sql),
      ];
      expect(sqlCalls.some((sql) => sql.includes("ec.manual_replied_at IS NULL"))).toBe(true);
      expect(sqlCalls.some((sql) => sql.includes("email_thread_user_state"))).toBe(false);
    }
  });

  it("marks the shared thread replied, closes its reply task, and clears waiting notifications", async () => {
    mocks.queryOne.mockResolvedValueOnce({ id: "email-1", candidate_id: "candidate-1", gmail_thread_id: "thread-1", needs_reply: true });

    const response = await saveFeedback(new NextRequest("https://talentos.test/api/gmail-communications/email-1/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "mark_replied" }),
    }), emailParams);

    expect(response.status).toBe(200);
    expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining("manual_replied_at = CASE"), ["thread-1"]);
    expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining("status='done'"), ["user-1", "thread-1"]);
    expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining("UPDATE notifications SET read_at=COALESCE(read_at,now())"), ["thread-1"]);
    expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO candidate_workflow_events"), ["candidate-1", "email-1", "user-1", JSON.stringify({ kind: "mark_replied" })]);
  });

  it("marks the shared thread no-reply-needed and dismisses its open reply tasks without counting a reply", async () => {
    mocks.queryOne.mockResolvedValueOnce({ id: "email-1", candidate_id: "candidate-1", gmail_thread_id: "thread-1", needs_reply: true });

    const response = await saveFeedback(new NextRequest("https://talentos.test/api/gmail-communications/email-1/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "no_reply_needed" }),
    }), emailParams);

    expect(response.status).toBe(200);
    expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining("SET needs_reply=false, manual_replied_at=NULL"), ["thread-1"]);
    expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining("UPDATE action_items SET status='dismissed'"), ["user-1", "thread-1"]);
    expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining("UPDATE notifications SET read_at=COALESCE(read_at,now())"), ["thread-1"]);
    expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO candidate_workflow_events"), ["candidate-1", "email-1", "user-1", JSON.stringify({ kind: "no_reply_needed" })]);
    expect(mocks.execute).not.toHaveBeenCalledWith(expect.stringContaining("manual_replied_at = CASE"), expect.anything());
  });
});
