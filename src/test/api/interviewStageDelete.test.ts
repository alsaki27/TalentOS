// Regression coverage for removing an interview stage (round 1-4) so it can
// be scheduled again from scratch, instead of being stuck once added — the
// modal previously only supported add/edit, with no way back out.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUserContext: vi.fn(),
  queryOne: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUserContext: mocks.getCurrentUserContext,
}));

vi.mock("@/server/db/neon", () => ({
  queryOne: mocks.queryOne,
}));

import { NextRequest } from "next/server";
import { DELETE } from "@/app/api/applications/[id]/interviews/[scheduleId]/route";

const applicationId = "11111111-1111-1111-1111-111111111111";
const scheduleId = "22222222-2222-2222-2222-222222222222";

function req() {
  return new NextRequest(`https://talentos.test/api/applications/${applicationId}/interviews/${scheduleId}`, {
    method: "DELETE",
  });
}

describe("DELETE /api/applications/[id]/interviews/[scheduleId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires an authenticated session", async () => {
    mocks.getCurrentUserContext.mockResolvedValue(null);

    const response = await DELETE(req(), { params: { id: applicationId, scheduleId } });

    expect(response.status).toBe(401);
    expect(mocks.queryOne).not.toHaveBeenCalled();
  });

  it("deletes the stage scoped to both its id and the application id", async () => {
    mocks.getCurrentUserContext.mockResolvedValue({ profile: { display_name: "Staff" } });
    mocks.queryOne.mockResolvedValue({ id: scheduleId });

    const response = await DELETE(req(), { params: { id: applicationId, scheduleId } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(mocks.queryOne).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM interview_schedules WHERE id = $1 AND application_id = $2"),
      [scheduleId, applicationId]
    );
  });

  it("404s when the stage does not exist (or belongs to a different application)", async () => {
    mocks.getCurrentUserContext.mockResolvedValue({ profile: { display_name: "Staff" } });
    mocks.queryOne.mockResolvedValue(null);

    const response = await DELETE(req(), { params: { id: applicationId, scheduleId } });

    expect(response.status).toBe(404);
  });
});
