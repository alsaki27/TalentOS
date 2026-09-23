import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db/neon", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

import { query, queryOne, execute } from "@/server/db/neon";
import { checkJobDuplicate, checkJobDuplicatesBatch } from "@/server/services/jobDuplicateGuard";

const EXISTING = {
  id: "job-1",
  title: "Existing Job",
  company: "Existing Co",
  location: "Remote",
  apply_url: "https://company.com/apply/1",
  source_url: null,
  source: "manual",
  created_at: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  (execute as any).mockResolvedValue({ rowCount: 1 });
});

describe("checkJobDuplicate", () => {
  it("returns isDuplicate: false with no DB call when neither URL is present", async () => {
    const result = await checkJobDuplicate({});
    expect(result).toEqual({ isDuplicate: false, fingerprint: null });
    expect(queryOne).not.toHaveBeenCalled();
  });

  it("returns the existing job when the fingerprint matches", async () => {
    (queryOne as any).mockResolvedValue(EXISTING);
    const result = await checkJobDuplicate({ applyUrl: "https://company.com/apply/1" });
    expect(result.isDuplicate).toBe(true);
    if (result.isDuplicate) {
      expect(result.existing.id).toBe("job-1");
      expect(result.fingerprint).toBeTruthy();
    }
  });

  it("returns isDuplicate: false when the fingerprint doesn't match anything", async () => {
    (queryOne as any).mockResolvedValue(null);
    const result = await checkJobDuplicate({ applyUrl: "https://company.com/apply/999" });
    expect(result.isDuplicate).toBe(false);
  });

  it("bumps last_seen_at on the matched job when a duplicate is found", async () => {
    (queryOne as any).mockResolvedValue(EXISTING);
    await checkJobDuplicate({ applyUrl: "https://company.com/apply/1" });
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("last_seen_at"), ["job-1"]);
  });
});

describe("checkJobDuplicatesBatch", () => {
  it("resolves a mixed batch (duplicate, new, no-URL) with exactly one query", async () => {
    (query as any).mockResolvedValue([{ ...EXISTING, apply_link_fingerprint: "company.com/apply/1" }]);

    const results = await checkJobDuplicatesBatch([
      { applyUrl: "https://company.com/apply/1" }, // duplicate
      { applyUrl: "https://company.com/apply/new" }, // new
      {}, // no URL at all
    ]);

    expect(query).toHaveBeenCalledTimes(1);
    expect(results[0].isDuplicate).toBe(true);
    expect(results[1].isDuplicate).toBe(false);
    expect(results[2]).toEqual({ isDuplicate: false, fingerprint: null });
  });

  it("makes no DB call at all when every candidate lacks a URL", async () => {
    const results = await checkJobDuplicatesBatch([{}, {}]);
    expect(query).not.toHaveBeenCalled();
    expect(results.every((r) => !r.isDuplicate)).toBe(true);
  });
});
