import { beforeEach, describe, expect, it, vi } from "vitest";
const { queryOne } = vi.hoisted(() => ({ queryOne: vi.fn() }));
vi.mock("@/server/db/neon", () => ({ queryOne }));
import { cleanCapturedCompany, resolveJobCaptureTarget } from "@/server/services/jobCaptureStatusService";

describe("captured job status", () => {
  beforeEach(() => vi.resetAllMocks());

  it("resolves a hidden LinkedIn copy to the active canonical job without changing visibility", async () => {
    queryOne.mockResolvedValueOnce({ id: "linkedin-copy", is_active: false, content_duplicate_of: "original" })
      .mockResolvedValueOnce({ id: "original", is_active: true });
    expect(await resolveJobCaptureTarget("linkedin-copy")).toMatchObject({
      job: { id: "original", is_active: true },
      jobStatus: { state: "active", requestedJobId: "linkedin-copy", canonicalJobId: "original", redirected: true, sourceAvailability: "unverified" },
    });
  });

  it("preserves a deliberately inactive job and distinguishes a deleted job", async () => {
    queryOne.mockResolvedValueOnce({ id: "inactive", is_active: false }).mockResolvedValueOnce(null);
    expect((await resolveJobCaptureTarget("inactive")).jobStatus.state).toBe("inactive");
    expect((await resolveJobCaptureTarget("deleted")).jobStatus.state).toBe("missing");
  });

  it("follows multiple hidden copies and stops on missing parents or cycles", async () => {
    const rows: Record<string, unknown> = {
      a: { id: "a", is_active: false, content_duplicate_of: "b" },
      b: { id: "b", is_active: false, content_duplicate_of: "a" },
    };
    queryOne.mockImplementation(async (_sql, [id]) => rows[id] ?? null);
    expect((await resolveJobCaptureTarget("a")).jobStatus.state).toBe("inactive");
    expect(queryOne).toHaveBeenCalledTimes(2);
    rows.b = { id: "b", is_active: false, content_duplicate_of: "deleted" };
    expect((await resolveJobCaptureTarget("a")).jobStatus.state).toBe("inactive");
  });

  it("honors a manually reactivated distinct opening instead of following its old duplicate flag", async () => {
    queryOne.mockResolvedValue({ id: "reviewed", is_active: true, content_duplicate_of: "original" });
    expect((await resolveJobCaptureTarget("reviewed")).job?.id).toBe("reviewed");
    expect(queryOne).toHaveBeenCalledTimes(1);
  });
});

describe("capture employer validation", () => {
  it.each(["Home", "Sign in", "Skip to main content", "Indeed.com", "Indeed"])("rejects navigation/site name %s", (value) => {
    expect(cleanCapturedCompany(value, "https://www.indeed.com/viewjob?jk=abc")).toBeNull();
  });
  it("keeps actual employers and rejects a site fallback with provenance", () => {
    expect(cleanCapturedCompany(" Kinder Morgan, Inc. ", "https://linkedin.com/jobs/view/1")).toBe("Kinder Morgan, Inc.");
    expect(cleanCapturedCompany("Indeed", "https://indeed.com/viewjob?jk=x", ["og:site_name"])).toBeNull();
  });
});
