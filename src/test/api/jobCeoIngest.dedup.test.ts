// Coverage for POST /api/job-ceo/ingest's dedup behavior — specifically the
// real-world scenario this route used to get wrong: two distinct job
// postings from a single-employer staffing board (same title, same company,
// different external_job_id) must BOTH be staged, not collapsed into one via
// a bare title|company signature. See computeJobDedupSignature's docstring
// and jobCeoDedupSignature.test.ts for the underlying unit coverage.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  createRun: vi.fn(),
  bumpRunCounts: vi.fn().mockResolvedValue(undefined),
  insertStaged: vi.fn(),
  checkAndRecordDedup: vi.fn(),
  backgroundDispatch: vi.fn(),
}));

vi.mock("@/server/repositories/jobCeoRunRepository", () => ({
  createRun: mocks.createRun,
  bumpRunCounts: mocks.bumpRunCounts,
}));
vi.mock("@/server/lib/waitUntil", () => ({
  backgroundDispatch: mocks.backgroundDispatch,
}));

// Deliberately NOT mocking jobCeoStagingRepository's computeJobDedupSignature —
// this test exercises the real function so a regression there fails here too.
vi.mock("@/server/repositories/jobCeoStagingRepository", async () => {
  const actual = await vi.importActual<typeof import("@/server/repositories/jobCeoStagingRepository")>(
    "@/server/repositories/jobCeoStagingRepository"
  );
  return {
    ...actual,
    insertStaged: mocks.insertStaged,
    checkAndRecordDedup: mocks.checkAndRecordDedup,
  };
});

import { NextRequest } from "next/server";
import { POST } from "@/app/api/job-ceo/ingest/route";

function req(body: Record<string, unknown>) {
  return new NextRequest("https://talentos.test/api/job-ceo/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-secret" },
    body: JSON.stringify(body),
  });
}

const ACTALENT_GIS_1 = {
  title: "GIS Analyst",
  company: "Actalent",
  location: "Madison, Wisconsin, USA",
  source_url: "https://careers.actalentservices.com/us/en/job/JP-006260691/GIS-Analyst",
  external_job_id: "JP-006260691",
  raw: { source: "actalentservices" },
};
const ACTALENT_GIS_2 = {
  ...ACTALENT_GIS_1,
  location: "Remote, USA",
  source_url: "https://careers.actalentservices.com/us/en/job/JP-006274238/Remote-GIS-Analyst",
  external_job_id: "JP-006274238",
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JOB_CEO_INGEST_SECRET = "test-secret";
  mocks.createRun.mockResolvedValue({ id: "run-1" });
  mocks.insertStaged.mockImplementation(async (_runId: string, rows: unknown[]) => rows.length);
});

describe("POST /api/job-ceo/ingest — dedup by external_job_id", () => {
  it("stages both jobs when two postings share title+company but carry distinct external_job_ids", async () => {
    // checkAndRecordDedup reports both id-namespaced signatures as new —
    // the real implementation would, since they're distinct strings.
    mocks.checkAndRecordDedup.mockImplementation(async (_runId: string, sigs: { signature: string }[]) => {
      return new Set(sigs.map((s) => s.signature));
    });

    const res = await POST(req({ jobs: [ACTALENT_GIS_1, ACTALENT_GIS_2] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.staged).toBe(2);
    expect(body.skipped).toBe(0);

    // The two signatures actually checked must be distinct (this is the
    // concrete regression: they used to both be "gis analyst|actalent").
    const sigsChecked = mocks.checkAndRecordDedup.mock.calls[0][1] as { signature: string }[];
    expect(sigsChecked).toHaveLength(2);
    expect(sigsChecked[0].signature).not.toBe(sigsChecked[1].signature);
    expect(sigsChecked[0].signature).toBe("id:actalentservices:jp-006260691");
    expect(sigsChecked[1].signature).toBe("id:actalentservices:jp-006274238");
  });

  it("skips a job whose id-namespaced signature was already seen in a prior run", async () => {
    // Simulate: only the second signature is genuinely new.
    mocks.checkAndRecordDedup.mockImplementation(async (_runId: string, sigs: { signature: string }[]) => {
      return new Set([sigs[1].signature]);
    });

    const res = await POST(req({ jobs: [ACTALENT_GIS_1, ACTALENT_GIS_2] }));
    const body = await res.json();

    expect(body.staged).toBe(1);
    expect(body.skipped).toBe(1);
    expect(mocks.insertStaged).toHaveBeenCalledWith("run-1", [ACTALENT_GIS_2]);
  });

  it("falls back to title|company for a job with no external_job_id (e.g. legacy OpenJobData rows)", async () => {
    mocks.checkAndRecordDedup.mockImplementation(async (_runId: string, sigs: { signature: string }[]) => {
      return new Set(sigs.map((s) => s.signature));
    });

    await POST(req({ jobs: [{ title: "Fiber Engineer", company: "Some Co" }] }));

    const sigsChecked = mocks.checkAndRecordDedup.mock.calls[0][1] as { signature: string }[];
    expect(sigsChecked[0].signature).toBe("fiber engineer|some co");
  });

  it("rejects with 401 when the bearer secret is missing or wrong", async () => {
    const res = await POST(
      new NextRequest("https://talentos.test/api/job-ceo/ingest", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer wrong" },
        body: JSON.stringify({ jobs: [ACTALENT_GIS_1] }),
      })
    );
    expect(res.status).toBe(401);
    expect(mocks.insertStaged).not.toHaveBeenCalled();
  });
});

describe("POST /api/job-ceo/ingest — derives the new run's source from the job payload", () => {
  // This endpoint is shared by every scraper (OpenJobData, Actalent,
  // Broadstaff, any future one) — it used to hardcode source: "openjobdata"
  // on every run it created regardless of who actually called it, so the Job
  // CEO run history mislabeled every Actalent/Broadstaff run. One POST body
  // is always one script's own batch (every job in it carries the same
  // raw.source), so reading it off the first job is exact, not a guess.
  beforeEach(() => {
    mocks.checkAndRecordDedup.mockImplementation(async (_runId: string, sigs: { signature: string }[]) => {
      return new Set(sigs.map((s) => s.signature));
    });
  });

  it("creates the run with the posted job's raw.source", async () => {
    await POST(req({ jobs: [ACTALENT_GIS_1] }));
    expect(mocks.createRun).toHaveBeenCalledWith(expect.objectContaining({ source: "actalentservices" }));
  });

  it("uses the same source for a Broadstaff-tagged batch", async () => {
    await POST(req({ jobs: [{ title: "Coax Splicer", company: "Broadstaff", external_job_id: "14226914", raw: { source: "broadstaffglobal" } }] }));
    expect(mocks.createRun).toHaveBeenCalledWith(expect.objectContaining({ source: "broadstaffglobal" }));
  });

  it("falls back to 'openjobdata' when no job carries a raw.source", async () => {
    await POST(req({ jobs: [{ title: "Fiber Engineer", company: "Some Co" }] }));
    expect(mocks.createRun).toHaveBeenCalledWith(expect.objectContaining({ source: "openjobdata" }));
  });

  it("does not call createRun at all when the caller already supplied a runId", async () => {
    await POST(req({ runId: "existing-run", jobs: [ACTALENT_GIS_1] }));
    expect(mocks.createRun).not.toHaveBeenCalled();
    expect(mocks.insertStaged).toHaveBeenCalledWith("existing-run", [ACTALENT_GIS_1]);
  });

  it("ignores a non-string or blank raw.source rather than passing it through", async () => {
    await POST(req({ jobs: [{ title: "X", company: "Y", raw: { source: "   " } }] }));
    expect(mocks.createRun).toHaveBeenCalledWith(expect.objectContaining({ source: "openjobdata" }));
  });
});
