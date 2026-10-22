import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  queryOne: vi.fn(),
  transaction: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireCurrentUser: mocks.requireCurrentUser }));
vi.mock("@/server/db/neon", () => ({ queryOne: mocks.queryOne, sql: mocks.sql }));

import { NextRequest } from "next/server";
import { DELETE } from "@/app/api/users/[id]/route";

const adminId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const memberId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const readySchema = `SELECT true AS ready`;

function makeRequest() {
  return new NextRequest(`https://talentos.test/api/users/${memberId}`, { method: "DELETE" });
}

describe("permanent team member deletion API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCurrentUser.mockResolvedValue({
      context: { profile: { user_id: adminId, email: "admin@example.com" } },
      response: null,
    });
    mocks.queryOne
      .mockResolvedValueOnce({ user_id: memberId, role: "application_engineer", is_active: true })
      .mockResolvedValueOnce({ ready: true });
    mocks.sql.mockReturnValue({ transaction: mocks.transaction });
    mocks.transaction.mockImplementation(async (callback: (tx: (strings: TemplateStringsArray, ...values: unknown[]) => unknown) => unknown[]) => {
      const tx = (strings: TemplateStringsArray, ...values: unknown[]) => ({ text: strings.join("?"), values });
      callback(tx);
      return [[], [], [], [], [{ user_id: memberId }]];
    });
  });

  it("anonymizes activity and deletes a non-admin member in one transaction", async () => {
    const response = await DELETE(makeRequest(), { params: { id: memberId } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    const queries = mocks.transaction.mock.calls[0][0]((strings: TemplateStringsArray, ...values: unknown[]) => ({
      text: strings.join("?"),
      values,
    }));
    expect(queries).toHaveLength(5);
    expect(queries[0].text).toContain("pg_advisory_xact_lock");
    expect(queries[3].text).toContain("INSERT INTO audit_logs");
    expect(queries[4].text).toContain("DELETE FROM profiles");
  });

  it("returns a clear prerequisite error when migration 122 is not installed", async () => {
    mocks.queryOne.mockReset();
    mocks.queryOne
      .mockResolvedValueOnce({ user_id: memberId, role: "application_engineer", is_active: true })
      .mockResolvedValueOnce({ ready: false });

    const response = await DELETE(makeRequest(), { params: { id: memberId } });

    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("migration 122");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("prevents deleting the last active administrator", async () => {
    mocks.queryOne.mockReset();
    mocks.queryOne
      .mockResolvedValueOnce({ user_id: memberId, role: "admin", is_active: true })
      .mockResolvedValueOnce({ ready: true });
    mocks.transaction.mockResolvedValueOnce([[], [], [], [], []]);

    const response = await DELETE(makeRequest(), { params: { id: memberId } });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("last active admin");
  });

  it("rejects self-deletion before querying the database", async () => {
    const response = await DELETE(makeRequest(), { params: { id: adminId } });

    expect(response.status).toBe(400);
    expect(mocks.queryOne).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
