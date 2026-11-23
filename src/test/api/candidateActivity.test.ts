import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { GET } from "@/app/api/candidates/[id]/activity/route";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), activity: vi.fn() }));
vi.mock("@/lib/auth", () => ({ ALL_USER_ROLES: ["admin", "manager", "application_engineer"], requireCurrentUser: mocks.auth }));
vi.mock("@/server/services/candidateActivityService", () => ({ getCandidateActivity: mocks.activity }));
const id = "11111111-1111-4111-8111-111111111111";
const request = (query = "") => new Request(`https://example.test/api/candidates/${id}/activity${query}`);
describe("Candidate activity API", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ response: null }); mocks.activity.mockResolvedValue({ items: [], nextCursor: null }); });
  it("authenticates before reading candidate history", async () => {
    mocks.auth.mockResolvedValue({ response: NextResponse.json({ error: "Authentication required" }, { status: 401 }) });
    expect((await GET(request(), { params: { id } })).status).toBe(401);
    expect(mocks.activity).not.toHaveBeenCalled();
  });
  it("validates filters, cursor, limits and candidate IDs", async () => {
    for (const query of ["?limit=0", "?limit=999", "?limit=1.5", "?type=secrets", "?cursor=invalid", "?page=0", "?page=1.5"]) expect((await GET(request(query), { params: { id } })).status).toBe(400);
    expect((await GET(request(), { params: { id: "bad" } })).status).toBe(404);
    expect(mocks.activity).not.toHaveBeenCalled();
  });
  it("returns seven entries by default with private, uncached responses", async () => {
    const result = await GET(request(), { params: { id } });
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.activity).toHaveBeenCalledWith(id, { limit: 7, cursor: null, type: undefined });
  });
  it("passes numbered pages with a twenty-item limit to the activity reader", async () => {
    expect((await GET(request("?limit=20&page=2"), {params:{id}})).status).toBe(200);
    expect(mocks.activity).toHaveBeenCalledWith(id,{limit:20,cursor:null,type:undefined,page:2});
  });
});
