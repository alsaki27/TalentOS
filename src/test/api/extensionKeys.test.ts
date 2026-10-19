import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  query: vi.fn(),
  queryOne: vi.fn(),
  guardedSafetyCheck: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireCurrentUser: mocks.requireCurrentUser }));
vi.mock("@/server/db/neon", () => ({ query: mocks.query, queryOne: mocks.queryOne, execute: vi.fn() }));
vi.mock("@/lib/safetyCheck", () => ({ guardedSafetyCheck: mocks.guardedSafetyCheck }));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/admin/extension-keys/route";

describe("admin extension API key ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCurrentUser.mockResolvedValue({ response: null });
    mocks.guardedSafetyCheck.mockResolvedValue(undefined);
  });

  it("requires an owner for capture keys so extension work is attributed", async () => {
    const response = await POST(new NextRequest("https://talentos.test/api/admin/extension-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Manager capture", scopes: ["extension:job:capture"] }),
    }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("active team member");
    expect(mocks.queryOne).not.toHaveBeenCalled();
  });

  it("allows any active team role to own a candidate-logging key", async () => {
    mocks.queryOne
      .mockResolvedValueOnce({ user_id: "manager-1" })
      .mockResolvedValueOnce({ id: "key-1" });

    const response = await POST(new NextRequest("https://talentos.test/api/admin/extension-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label: "Manager workflow",
        scopes: ["extension:job:capture", "extension:application:assign"],
        ownerUserId: "manager-1",
      }),
    }));

    expect(response.status).toBe(201);
    expect(mocks.queryOne).toHaveBeenNthCalledWith(1, expect.not.stringContaining("role = 'application_engineer'"), ["manager-1"]);
    expect(mocks.queryOne).toHaveBeenNthCalledWith(2, expect.stringContaining("owner_user_id"), expect.arrayContaining(["Manager workflow"]));
    expect((await response.json()).ownerUserId).toBe("manager-1");
  });

  it("rejects inactive owners", async () => {
    mocks.queryOne.mockResolvedValueOnce(null);
    const response = await POST(new NextRequest("https://talentos.test/api/admin/extension-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Inactive owner", scopes: ["extension:job:capture"], ownerUserId: "inactive-1" }),
    }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("active team member");
    expect(mocks.queryOne).toHaveBeenCalledTimes(1);
  });
});
