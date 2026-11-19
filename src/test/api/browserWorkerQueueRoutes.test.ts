import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as list, POST as enqueue } from "@/app/api/browser-worker/v3/jobs/route";
import { POST as register } from "@/app/api/browser-worker/v3/workers/route";
import { POST as claim } from "@/app/api/browser-worker/v3/claims/route";
import { POST as record } from "@/app/api/browser-worker/v3/jobs/[id]/result/route";
import { browserQueueJobUrl } from "@/lib/browserWorkerQueuePosting";
import { validateBrowserQueueResult } from "@/server/services/browserWorkerQueueService";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  requireCurrentUser: vi.fn(),
}));
vi.mock("@/server/db/neon", () => ({ query: mocks.query, queryOne: mocks.queryOne }));
vi.mock("@/lib/auth", () => ({
  MASTER_DATA_MANAGER_ROLES: ["admin", "manager"],
  requireCurrentUser: mocks.requireCurrentUser,
}));
vi.mock("@/lib/resumeStorage", () => ({ downloadResumeFile: vi.fn() }));

const applicationId = "10000000-0000-4000-8000-000000000001";
const workerId = "10000000-0000-4000-8000-000000000002";
const operatorId = "10000000-0000-4000-8000-000000000003";
const requestId = "10000000-0000-4000-8000-000000000004";
const origin = "https://talentos.example.test";
const workerHeaders = {
  Authorization: `Bearer tbwq_${"a".repeat(64)}`,
  "X-Browser-Worker-Lease": `tblq_${"b".repeat(64)}`,
};

function post(path: string, body: object, headers: HeadersInit = { Origin: origin }) {
  return new Request(`${origin}/api/browser-worker/v3/${path}`, {
    method: "POST", body: JSON.stringify(body), headers,
  });
}

describe("dedicated browser worker queue routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("BROWSER_WORKER_QUEUE_ENABLED", "true");
    vi.stubEnv("TALENTOS_BASE_URL", origin);
    mocks.requireCurrentUser.mockResolvedValue({ response: null, context: { user: { id: operatorId } } });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("strips tracking from a native posting and rejects deceptive or noncanonical URL shapes", () => {
    const posting = "https://www.linkedin.com/jobs/view/123";
    expect(browserQueueJobUrl(` ${posting}/?trackingId=EG%3D&refId=test `)).toBe(posting);
    for (const invalid of [`${posting}#other`, `${posting}?x=1#fragment`, `${posting}/apply`,
      `${posting}${"0".repeat(25)}`, "https://www.linkedin.com.evil.test/jobs/view/123",
      "https://www.indeed.com/jobs/view/123", `${posting}?raw=space x`, `${posting}\n`]) {
      expect(browserQueueJobUrl(invalid)).toBeNull();
    }
  });

  it("returns 404 before staff or database lookups when the feature is disabled", async () => {
    vi.stubEnv("BROWSER_WORKER_QUEUE_ENABLED", "false");
    expect((await list(new Request(`${origin}/api/browser-worker/v3/jobs`))).status).toBe(404);
    expect(mocks.requireCurrentUser).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("requires a manager or admin before returning worker labels", async () => {
    mocks.requireCurrentUser.mockResolvedValueOnce({
      response: NextResponse.json({ error: "Permission denied" }, { status: 403 }),
    });
    const request = new Request(`${origin}/api/browser-worker/v3/jobs`);
    expect((await list(request)).status).toBe(403);
    expect(mocks.requireCurrentUser).toHaveBeenCalledWith(["admin", "manager"]);
    expect(mocks.query).not.toHaveBeenCalled();

    mocks.query.mockResolvedValueOnce([{ id: workerId, label: "Dedicated PC" }]);
    const response = await list(request);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(await response.json()).toEqual({ enabled: true, workers: [{ id: workerId, label: "Dedicated PC" }] });
    expect(mocks.query.mock.calls[0][0]).toContain("SELECT id, label");
  });

  it.each([{}, { Origin: "https://other.example.test" }])("rejects staff writes without same-origin confirmation (%j)", async headers => {
    const response = await enqueue(post("jobs", { applicationId }, headers as HeadersInit));
    expect(response.status).toBe(403);
    expect(mocks.queryOne).not.toHaveBeenCalled();
  });

  it("returns the worker bearer once, persisting only its digest for the authenticated operator", async () => {
    mocks.queryOne.mockResolvedValueOnce({ id: workerId });
    const response = await register(post("workers", { label: "  Dedicated PC  " }));
    const { credential } = await response.json();
    expect(response.status).toBe(201);
    expect(credential).toMatch(/^tbwq_[a-f0-9]{64}$/);
    expect(mocks.queryOne.mock.calls[0][1]).toEqual([
      "Dedicated PC", createHash("sha256").update(credential).digest("hex"), operatorId,
    ]);
  });

  it("binds enqueue idempotency replay to the same application and operator", async () => {
    const row = { id: requestId, application_id: applicationId, worker_id: workerId, requested_by: operatorId, status: "queued" };
    const headers = { Origin: origin, "Idempotency-Key": "request-one" };
    mocks.queryOne.mockResolvedValueOnce(row).mockResolvedValueOnce(null).mockResolvedValueOnce(row);
    const first = await enqueue(post("jobs", { applicationId }, headers));
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ job: { requestId, requestedBy: operatorId }, duplicate: false });
    const replay = await enqueue(post("jobs", { applicationId }, headers));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ job: { requestId }, duplicate: true });
    mocks.queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(row);
    expect((await enqueue(post("jobs", { applicationId: workerId }, headers))).status).toBe(409);
  });

  it("rejects an invalid worker bearer or a cross-candidate profile reference", async () => {
    const profiles = [{ candidateId: applicationId, profileRef: workerId, profileVersion: "v1" }];
    expect((await claim(post("claims", { profiles }, {}))).status).toBe(401);
    expect((await claim(post("claims", { profiles }, workerHeaders))).status).toBe(400);
    expect(mocks.queryOne).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "valid candidate and job labels",
      labels: { candidate_name: "  শারমিন রহমান  ", job_title: "Senior Developer / Platform\n Engineering" },
      expectedNaming: { candidateName: "শারমিন রহমান", jobTitle: "Senior Developer / Platform Engineering" },
    },
    { label: "a missing label", labels: { candidate_name: "Example Candidate", job_title: null } },
    { label: "a control character", labels: { candidate_name: "Example Candidate", job_title: "Developer\u0007" } },
    { label: "legacy claims without labels", labels: {} },
  ])("serializes claim expiry and handles résumé naming with $label", async ({ labels, expectedNaming }) => {
    mocks.queryOne.mockResolvedValueOnce({ authorized: true, job: {
      id: requestId, attempt: 1, application_id: applicationId, candidate_id: applicationId, job_id: applicationId,
      lease_expires_at: "2026-11-15T07:30:59.123456+00:00", job_url: "https://www.linkedin.com/jobs/view/123",
      expected_dialog_heading: "Apply to Example", job_version: "a".repeat(64), profile_version: "v1",
      export_id: requestId, resume_version_id: workerId, content_sha256: "c".repeat(64), byte_length: 700,
      ...labels,
    } });
    const profiles = [{ candidateId: applicationId, profileRef: applicationId, profileVersion: "v1" }];
    const response = await claim(post("claims", { profiles }, workerHeaders));
    expect(response.status).toBe(200);
    const envelope = await response.json();
    expect(envelope).toMatchObject({
      attempt: 1, leaseExpiresAt: "2026-11-15T07:30:59.123Z", expectedDialogHeading: "Apply to Example",
      manifest: { mode: "prepare", applicationId, profileRef: applicationId, artifact: { exportId: requestId, byteLength: 700 } },
    });
    if (expectedNaming) expect(envelope.resumeNaming).toEqual(expectedNaming);
    else expect(envelope).not.toHaveProperty("resumeNaming");
  });

  it("rejects employer submission, evidence claims and fixture outcomes before writes", async () => {
    for (const result of [
      { status: "applied", reason: "confirmed" },
      { status: "submission_unknown", reason: "external_status_unknown" },
      { status: "prepared", reason: "final_review_ready", receipt: { externalReference: "unverified" } },
      { status: "needs_human", reason: "fixture_missing_required_answers" },
      { status: "needs_human", reason: "missing_verified_contact" },
    ]) {
      const response = await record(post("result", result, workerHeaders), { params: { id: requestId } });
      expect(response.status).toBe(400);
    }
    expect(mocks.queryOne).not.toHaveBeenCalled();
    expect(validateBrowserQueueResult({
      status: "needs_human", reason: "missing_required_answers", missingQuestions: ["  Are you available?  ", "Are you available?"],
    })).toEqual({ status: "needs_human", reason: "missing_required_answers", missingQuestions: ["Are you available?"] });
  });
});
