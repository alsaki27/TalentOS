import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ requireCurrentUser: vi.fn(), list: vi.fn(), candidates: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireCurrentUser: mocks.requireCurrentUser }));
vi.mock("@/server/repositories/applicationsRepository", () => ({
  listApplicationQueue: mocks.list,
  listApplicationQueueCandidates: mocks.candidates,
}));
import { GET } from "@/app/api/application-queue/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireCurrentUser.mockResolvedValue({ context: { profile: { user_id: "ae-1", role: "application_engineer" } }, response: null });
  mocks.list.mockResolvedValue({ items: [], total: 0, stats: {} });
  mocks.candidates.mockResolvedValue([]);
});

describe("application queue filters", () => {
  it.each([
    ["", "ae_review_pending_newest"],
    ["sort=ae_review_pending_newest", "ae_review_pending_newest"],
    ["sort=ae_review_pending", "ae_review_pending"],
    ["sort=invalid", "ae_review_pending_newest"],
    ["sort=due", "due"],
  ])("normalizes %s to %s", async (search, sort) => {
    const response = await GET(new NextRequest(`https://talentos.test/api/application-queue?${search}`));
    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ sort }));
  });

  it.each([["30m", 30], ["1h", 60], ["2h", 120], ["3h", 180], ["12h", 720], ["24h", 1440], ["3d", 4320], ["7d", 10080]])(
    "preserves combined filters with the %s activity window", async (timeWindow, minutes) => {
      await GET(new NextRequest(`https://talentos.test/api/application-queue?sort=ae_review_pending&time_window=${timeWindow}&candidate_id=c-1&view=ae_review&stage=ready_for_review&owner=ae-1&work_mode=remote&fit_score=8_10&priority=high&review=pending&search=Engineer&page=2&pageSize=25`));
      expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({
        sort: "ae_review_pending", timeWindowMinutes: minutes, candidateId: "c-1", view: "ae_review",
        stage: "ready_for_review", owner: "ae-1", workMode: "remote", fitScoreBand: "8_10",
        priority: "high", review: "pending", search: "Engineer", page: 2, pageSize: 25,
      }));
    },
  );

  it("requires authentication before returning rows or candidate choices", async () => {
    mocks.requireCurrentUser.mockResolvedValue({ context: null, response: new Response(null, { status: 401 }) });
    const response = await GET(new NextRequest("https://talentos.test/api/application-queue?options=candidates"));
    expect(response.status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.candidates).not.toHaveBeenCalled();
  });
});
