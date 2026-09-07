// Regression coverage for the previously-dead GET/PATCH handlers on
// /api/inbox/handover. Before this pass, "My Handovers" on /inbox called a
// GET that didn't exist (always silently rendered an empty list) and
// "Mark Done" called a PATCH that didn't exist either - confirmed dead
// during the shared-inbox redesign. POST (handover creation) already
// worked and is covered here too, to confirm adding the new handlers
// didn't disturb it.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  logActivity: vi.fn().mockResolvedValue(undefined),
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/auth", () => ({
  requireCurrentUser: mocks.requireCurrentUser,
}));
vi.mock("@/server/db/neon", () => ({
  query: mocks.query,
  queryOne: mocks.queryOne,
  execute: mocks.execute,
}));
vi.mock("@/lib/activity", () => ({
  logActivity: mocks.logActivity,
}));
vi.mock("@/lib/notifications", () => ({
  createNotification: mocks.createNotification,
}));

import { NextRequest } from "next/server";
import { GET, POST, PATCH } from "@/app/api/inbox/handover/route";

const context = { profile: { user_id: "user-1", display_name: "Test AE", email: "ae@test.com" } };

function req(body: Record<string, unknown>) {
  return new NextRequest("https://talentos.test/api/inbox/handover", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireCurrentUser.mockResolvedValue({ context, response: null });
});

describe("GET /api/inbox/handover", () => {
  it("returns handovers assigned to the current user", async () => {
    mocks.query.mockResolvedValue([{ id: "ai-1", title: "Email handover: Re: Offer", status: "open" }]);

    const res = await GET(new NextRequest("https://talentos.test/api/inbox/handover"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.handovers).toHaveLength(1);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("assigned_to_user_id = $1"), ["user-1"]);
  });
});

describe("PATCH /api/inbox/handover", () => {
  it("marks a handover owned by the current user as done", async () => {
    mocks.queryOne.mockResolvedValue({ id: "ai-1", candidate_id: "cand-1" });

    const res = await PATCH(new NextRequest("https://talentos.test/api/inbox/handover", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "ai-1", status: "done" }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining("resolved_at = now()"), ["done", "user-1", "ai-1"]);
  });

  it("404s for a handover not assigned to the current user", async () => {
    mocks.queryOne.mockResolvedValue(null);

    const res = await PATCH(new NextRequest("https://talentos.test/api/inbox/handover", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "ai-999", status: "done" }),
    }));

    expect(res.status).toBe(404);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("rejects an invalid status", async () => {
    const res = await PATCH(new NextRequest("https://talentos.test/api/inbox/handover", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "ai-1", status: "bogus" }),
    }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/inbox/handover (unchanged behavior)", () => {
  it("still creates a handover action item and notifies the assignee", async () => {
    mocks.queryOne
      .mockResolvedValueOnce({ candidate_id: "cand-1", subject: "Re: Offer", gmail_thread_id: "thread-1" }) // thread lookup
      .mockResolvedValueOnce({ id: "ai-new" }); // inserted action item

    const res = await POST(req({ email_communication_id: "ec-1", assignee_user_id: "user-2", priority: "high" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.action_item_id).toBe("ai-new");
    expect(mocks.createNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-2", type: "handover" }));
  });
});
