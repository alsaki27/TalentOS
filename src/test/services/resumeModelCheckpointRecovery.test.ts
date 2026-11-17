import { beforeEach, describe, expect, it, vi } from "vitest";
import { withResumeModelCheckpoint } from "@/server/repositories/resumeModelCheckpointRepository";

const db = vi.hoisted(() => ({ queryOne: vi.fn(), execute: vi.fn() }));
vi.mock("@/server/db/neon", () => db);

const input = { workflowId: "retry", identity: { model: "luna" }, task: { system: "system", body: "body", schema: {} } };
const evidenceSelection = { prioritize: ["b0.1"] };

describe("resume forge checkpoint recovery", () => {
  beforeEach(() => vi.resetAllMocks());

  it("reuses verified fallback selection for a confirmed paid reply with rejected evidence IDs", async () => {
    db.queryOne.mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ status: "uncertain", workflow_id: "original", updated_at: "2026-11-17 03:46:09+00" })
      .mockResolvedValueOnce({ confirmed: true })
      .mockResolvedValueOnce({ result: evidenceSelection });
    const paidCall = vi.fn(async () => ({ prioritize: ["another"] }));
    await expect(withResumeModelCheckpoint(input, paidCall, {
      model: "luna", result: () => evidenceSelection,
    })).resolves.toEqual({ result: evidenceSelection, reused: true });
    expect(paidCall).not.toHaveBeenCalled();
    const [, , [lookup, binds], [update]] = db.queryOne.mock.calls;
    expect(lookup).toContain("output_tokens > 0");
    expect(binds).toEqual(["original", "application_resume_forge_evidence_v2", "luna", "2026-11-17 03:46:09+00"]);
    expect(update).toContain("status = 'uncertain'");
  });

  it("keeps an unconfirmed timeout blocked without replaying or replacing the earlier request", async () => {
    db.queryOne.mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ status: "uncertain", workflow_id: "original" })
      .mockResolvedValueOnce({ confirmed: false });
    const paidCall = vi.fn();
    const fallback = vi.fn();
    await expect(withResumeModelCheckpoint(input, paidCall, { model: "luna", result: fallback }))
      .rejects.toThrow("no confirmed result");
    expect(paidCall).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  });
});
