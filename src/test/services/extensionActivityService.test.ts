import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@/server/db/neon", () => ({ execute: mocks.execute }));

import { recordExtensionActivity } from "@/server/services/extensionActivityService";

describe("extension activity actor snapshots", () => {
  beforeEach(() => vi.clearAllMocks());

  it("falls back to the legacy insert while snapshot migration columns are absent", async () => {
    mocks.execute
      .mockRejectedValueOnce(Object.assign(new Error('column "actor_display_name" does not exist'), {
        code: "42703",
        column: "actor_display_name",
      }))
      .mockResolvedValueOnce({ rowCount: 1 });

    await recordExtensionActivity({ actorUserId: "user-1", eventType: "job_added" });

    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(mocks.execute.mock.calls[0][0]).toContain("actor_display_name");
    expect(mocks.execute.mock.calls[1][0]).not.toContain("actor_display_name");
  });

  it("does not hide unrelated database failures", async () => {
    mocks.execute.mockRejectedValueOnce(Object.assign(new Error("database unavailable"), { code: "08006" }));

    await expect(recordExtensionActivity({ actorUserId: "user-1", eventType: "job_added" }))
      .rejects.toThrow("database unavailable");
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
});
