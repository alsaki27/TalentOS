import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUserContext: vi.fn(),
  queryOne: vi.fn(),
  transaction: vi.fn(),
  txQuery: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUserContext: mocks.getCurrentUserContext,
}));

vi.mock("@/server/db/neon", () => ({
  queryOne: mocks.queryOne,
  sql: () => ({ transaction: mocks.transaction }),
}));

import { NextRequest } from "next/server";
import { DELETE, PATCH } from "@/app/api/applications/[id]/interviews/[scheduleId]/route";

const applicationId = "11111111-1111-1111-1111-111111111111";
const scheduleId = "22222222-2222-2222-2222-222222222222";

function req() {
  return new NextRequest(`https://talentos.test/api/applications/${applicationId}/interviews/${scheduleId}`, {
    method: "DELETE",
  });
}

describe("DELETE /api/applications/[id]/interviews/[scheduleId]", () => {
  beforeEach(() => vi.resetAllMocks());

  it("requires an authenticated session", async () => {
    mocks.getCurrentUserContext.mockResolvedValue(null);

    const response = await DELETE(req(), { params: { id: applicationId, scheduleId } });

    expect(response.status).toBe(401);
    expect(mocks.queryOne).not.toHaveBeenCalled();
  });

  it("locks the application and renumbers its surviving stages in the same transaction", async () => {
    mocks.getCurrentUserContext.mockResolvedValue({ profile: { display_name: "Staff" } });
    mocks.queryOne.mockResolvedValueOnce({ status: "interview" });
    mocks.transaction.mockImplementationOnce((run) => {
      run({ query: mocks.txQuery });
      return [[{ id: applicationId }], [{ id: scheduleId }]];
    });

    const response = await DELETE(req(), { params: { id: applicationId, scheduleId } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(mocks.txQuery.mock.calls[0][0]).toContain("FOR UPDATE");
    expect(mocks.txQuery.mock.calls[0][1]).toEqual([applicationId]);
    expect(mocks.txQuery.mock.calls[1][0]).toContain("DELETE FROM interview_schedules s USING applications a");
    expect(mocks.txQuery.mock.calls[1][0]).toContain("s.application_id = $2 AND s.id <> $1 AND EXISTS (SELECT 1 FROM deleted)");
    expect(mocks.txQuery.mock.calls[1][0]).toContain("UPDATE interview_schedules s SET round_number = n.new_round");
    expect(mocks.txQuery.mock.calls[1][1]).toEqual([scheduleId, applicationId]);
  });

  it("404s when the stage does not exist (or belongs to a different application)", async () => {
    mocks.getCurrentUserContext.mockResolvedValue({ profile: { display_name: "Staff" } });
    mocks.queryOne.mockResolvedValueOnce({ status: "interview" });
    mocks.transaction.mockResolvedValueOnce([[{ id: applicationId }], []]);

    const response = await DELETE(req(), { params: { id: applicationId, scheduleId } });

    expect(response.status).toBe(404);
  });
});

describe("PATCH interview stage", () => {
  function patch(body: object) {
    return PATCH(new NextRequest(`https://talentos.test/api/applications/${applicationId}/interviews/${scheduleId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }), { params: { id: applicationId, scheduleId } });
  }

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getCurrentUserContext.mockResolvedValue({ profile: { user_id: applicationId, display_name: "Staff", email: null } });
  });

  it("persists an explicit No without treating it as missing", async () => {
    mocks.queryOne.mockResolvedValueOnce({ status: "interview" });
    mocks.queryOne.mockResolvedValueOnce({ scheduled_at: null, status: "planned", has_new_fields: true });
    mocks.queryOne.mockResolvedValueOnce({ id: scheduleId, mock_interview_taken: false });
    const result = await patch({ mockInterviewTaken: false });
    expect(result.status).toBe(200);
    expect(mocks.queryOne.mock.calls[2][0]).toContain("mock_interview_taken = $1");
    expect(mocks.queryOne.mock.calls[2][1].slice(0, 3)).toEqual([false, scheduleId, applicationId]);
    expect((await result.json()).stage.mock_interview_taken).toBe(false);
  });

  it("requires a boolean and explains a missing migration before saving", async () => {
    mocks.queryOne
      .mockResolvedValueOnce({ status: "interview" }).mockResolvedValueOnce({ scheduled_at: null, status: "planned", has_new_fields: false })
      .mockResolvedValueOnce({ status: "interview" }).mockResolvedValueOnce({ scheduled_at: null, status: "planned", has_new_fields: false });
    expect((await patch({ mockInterviewTaken: "No" })).status).toBe(400);
    expect((await patch({ mockInterviewTaken: true })).status).toBe(503);
    expect(mocks.queryOne).toHaveBeenCalledTimes(4);
  });

  it("records the old date and timezone when rescheduling", async () => {
    mocks.queryOne.mockResolvedValueOnce({ status: "interview" });
    mocks.queryOne.mockResolvedValueOnce({ scheduled_at: "2026-11-18T12:00:00Z", status: "scheduled", has_new_fields: true });
    mocks.queryOne.mockResolvedValueOnce({ id: scheduleId, scheduled_at: "2026-11-19T12:00:00Z", was_rescheduled: true });
    const result = await patch({ scheduledAt: "2026-11-19T12:00:00Z", timeZone: "America/Chicago" });
    expect(result.status).toBe(200);
    expect((await result.json()).rescheduled).toBe(true);
    expect(mocks.queryOne.mock.calls[2][0]).toContain("THEN 'interview_stage.rescheduled'");
    expect(mocks.queryOne.mock.calls[2][0]).toMatch(/previous_scheduled_at = CASE .* THEN scheduled_at/);
    expect(mocks.queryOne.mock.calls[2][0]).toMatch(/previous_time_zone = CASE .* THEN time_zone/);
  });

  it("keeps a notes-only edit separate from a reschedule", async () => {
    mocks.queryOne.mockResolvedValueOnce({ status: "interview" });
    mocks.queryOne.mockResolvedValueOnce({ scheduled_at: "2026-11-18T12:00:00Z", status: "scheduled", has_new_fields: true });
    mocks.queryOne.mockResolvedValueOnce({ id: scheduleId });
    const result = await patch({ notes: "Updated notes" });
    expect(result.status).toBe(200);
    expect((await result.json()).rescheduled).toBe(false);
    expect(mocks.queryOne.mock.calls[2][0]).not.toContain("previous_scheduled_at =");
  });

  it("blocks edits until the application reaches Interview", async () => {
    mocks.queryOne.mockResolvedValueOnce({ status: "applied", application_stage: "applied" });
    const result = await patch({ mockInterviewTaken: true });
    expect(result.status).toBe(409);
    expect(mocks.queryOne).toHaveBeenCalledTimes(1);
  });
});
