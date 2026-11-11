import { createHash } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/neon", () => ({ query: vi.fn(), queryOne: vi.fn() }));
vi.mock("@/lib/resumeStorage", () => ({ downloadResumeFile: vi.fn() }));
import { query, queryOne } from "@/server/db/neon";
import { downloadResumeFile } from "@/lib/resumeStorage";
import { authorizeLivePrepareLease, claimPrepareApplication, enrollPrepareApplication, getPrepareArtifact,
  recordPrepareResult, revokePrepareEnrollment, validatePreparePdf, validatePrepareResult } from "@/server/services/browserWorkerPrepareService";

const app = "11111111-1111-4111-8111-111111111111";
const candidate = "22222222-2222-4222-8222-222222222222";
const job = "33333333-3333-4333-8333-333333333333";
const run = "44444444-4444-4444-8444-444444444444";
const exportId = "55555555-5555-4555-8555-555555555555";
const version = "66666666-6666-4666-8666-666666666666";
const enrollment = "77777777-7777-4777-8777-777777777777";
const pdf = Buffer.from("%PDF-1.7\nfixture only\n%%EOF\n");
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const credential = `tbw_${"a".repeat(64)}`;
const lease = `tbl_${"b".repeat(64)}`;
const pinned = { id: enrollment, application_id: app, candidate_id: candidate, job_id: job, export_id: exportId,
  resume_version_id: version, profile_ref: candidate, profile_version: "local-v1", job_version: "job-v1",
  job_snapshot: { id: job }, job_url: "https://example.test/jobs/123", content_sha256: sha(pdf), byte_length: pdf.byteLength };
const claimInput = { candidateId: candidate, profileRef: candidate, profileVersion: "local-v1" };
const request = (key = credential, leaseToken = lease) => new Request("http://localhost/api/browser-worker/v2/claims", {
  headers: { authorization: `Bearer ${key}`, "x-browser-worker-lease": leaseToken },
});
const source = { ...pinned, resume_snapshot: { id: version, status: "approved" }, storage_provider: "sharepoint", storage_url: "https://tenant.sharepoint.com/archive.pdf", file_path: "archive.pdf" };
const enrollmentInput = { applicationId: app, candidateId: candidate, exportId, profileRef: candidate, profileVersion: "local-v1" };

describe("prepare-only enrollment and lease boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("BROWSER_WORKER_PREPARE_ENABLED", "true");
    vi.stubEnv("BROWSER_WORKER_ENVIRONMENT", "staging");
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([["false", "staging"], ["true", "production"], ["true", ""]])("requires both explicit staging gates (%s/%s)", async (enabled, env) => {
    vi.stubEnv("BROWSER_WORKER_PREPARE_ENABLED", enabled); vi.stubEnv("BROWSER_WORKER_ENVIRONMENT", env);
    await expect(claimPrepareApplication(request(), claimInput)).rejects.toMatchObject({ status: 404 });
    expect(queryOne).not.toHaveBeenCalled();
  });
  it("never accepts legacy extension credentials", async () => {
    await expect(claimPrepareApplication(request("tos_old-key"), claimInput)).rejects.toMatchObject({ status: 401 });
    expect(queryOne).not.toHaveBeenCalled();
  });
  it("rejects revoked, expired or missing enrollment", async () => {
    vi.mocked(queryOne).mockResolvedValue(null);
    await expect(claimPrepareApplication(request(), claimInput)).rejects.toMatchObject({ status: 401 });
    expect(vi.mocked(queryOne).mock.calls[0][1]).toEqual([sha(credential)]);
  });
  it.each([{ candidateId: app }, { profileRef: app }, { profileVersion: "changed" }])("rejects binding mismatch before claim mutation: %j", async change => {
    vi.mocked(queryOne).mockResolvedValue(pinned);
    await expect(claimPrepareApplication(request(), { ...claimInput, ...change })).rejects.toMatchObject({ status: 403 });
    expect(queryOne).toHaveBeenCalledTimes(1);
  });
  it("returns exact pinned manifest and a fresh opaque token, persisting only its hash", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(pinned).mockResolvedValueOnce({ id: run, lease_expires_at: "2026-11-08T01:05:00Z" });
    const result = await claimPrepareApplication(request(), claimInput);
    expect(result).toMatchObject({ runId: run, jobUrl: pinned.job_url, manifest: {
      candidateId: candidate, applicationId: app, jobId: job, mode: "prepare", profileRef: candidate,
      artifact: { exportId, resumeVersionId: version, sha256: sha(pdf), byteLength: pdf.byteLength, contentType: "application/pdf" },
    } });
    expect(result?.leaseToken).toMatch(/^tbl_[a-f0-9]{64}$/);
    expect(vi.mocked(queryOne).mock.calls[1][1]).toEqual([enrollment, sha(result!.leaseToken)]);
    expect(JSON.stringify(result)).not.toContain("storage_url");
  });
  it("returns no work for a current lease, completed result or stale source", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(pinned).mockResolvedValueOnce(null);
    await expect(claimPrepareApplication(request(), claimInput)).resolves.toBeNull();
  });
  it("fails closed for replaced, expired or no-longer-ready leases", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(pinned).mockResolvedValueOnce(null);
    await expect(authorizeLivePrepareLease(request(), run)).rejects.toMatchObject({ status: 409 });
  });
  it("stores only verified bytes and hashes the one-time enrollment credential", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(source).mockResolvedValueOnce({ id: enrollment, expires_at: "2026-11-09T01:00:00Z" });
    vi.mocked(downloadResumeFile).mockResolvedValue({ buffer: pdf, contentType: "application/pdf" });
    const result = await enrollPrepareApplication(enrollmentInput, app);
    expect(result.credential).toMatch(/^tbw_[a-f0-9]{64}$/);
    const params = vi.mocked(queryOne).mock.calls[1][1]!;
    expect(params[12]).toBe(pdf.toString("base64"));
    expect(params[13]).toBe(sha(result.credential));
    expect(params).not.toContain(result.credential);
  });
  it("never downloads when ready-stage/selected-approved-export eligibility fails", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null);
    await expect(enrollPrepareApplication(enrollmentInput, app)).rejects.toMatchObject({ status: 409 });
    expect(downloadResumeFile).not.toHaveBeenCalled();
  });
  it("rejects export overwrite between metadata lookup and download", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(source);
    vi.mocked(downloadResumeFile).mockResolvedValue({ buffer: Buffer.from("%PDF-wrong"), contentType: "application/pdf" });
    await expect(enrollPrepareApplication(enrollmentInput, app)).rejects.toMatchObject({ status: 409 });
    expect(queryOne).toHaveBeenCalledTimes(1);
  });
  it("rechecks after download and rejects source change or duplicate enrollment", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(source).mockResolvedValueOnce(null);
    vi.mocked(downloadResumeFile).mockResolvedValue({ buffer: pdf, contentType: "application/pdf" });
    await expect(enrollPrepareApplication(enrollmentInput, app)).rejects.toMatchObject({ status: 409 });
  });
  it("does not regenerate a nonarchived export", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ ...source, storage_provider: null, storage_url: null });
    await expect(enrollPrepareApplication(enrollmentInput, app)).rejects.toMatchObject({ status: 409 });
    expect(downloadResumeFile).not.toHaveBeenCalled();
  });
  it("serves the immutable database snapshot without storage access", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(pinned).mockResolvedValueOnce({ id: run })
      .mockResolvedValueOnce({ artifact: pdf.toString("base64") }).mockResolvedValueOnce(pinned).mockResolvedValueOnce({ id: run });
    await expect(getPrepareArtifact(request(), run)).resolves.toEqual(pdf);
    expect(downloadResumeFile).not.toHaveBeenCalled();
  });
  it("does not return corrupted snapshot bytes", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(pinned).mockResolvedValueOnce({ id: run })
      .mockResolvedValueOnce({ artifact: Buffer.from("wrong").toString("base64") });
    await expect(getPrepareArtifact(request(), run)).rejects.toMatchObject({ status: 409 });
  });
  it("revokes only an enrollment and records the authenticated actor", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ id: enrollment });
    await expect(revokePrepareEnrollment(enrollment, app)).resolves.toEqual({ revoked: true });
    expect(vi.mocked(queryOne).mock.calls[0][1]).toEqual([enrollment, app]);
  });
  it("records failure without any applications or lifecycle mutation", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(pinned); vi.mocked(query).mockResolvedValueOnce([{ id: run }]);
    await expect(recordPrepareResult(request(), run, { status: "failed", reason: "Fixture blocked" })).resolves.toMatchObject({ duplicate: false, status: "failed" });
    const mutation = vi.mocked(query).mock.calls[0][0];
    expect(mutation).toMatch(/^UPDATE browser_worker_prepare_runs/);
    expect(mutation).not.toMatch(/(?:UPDATE|INSERT INTO) (?:applications|application_stage_history|activity_logs)\b/);
  });
  it("allows exact completed result retry but rejects a conflicting result", async () => {
    const payload = { status: "needs_human", reason: "Login required", missingQuestions: [] };
    vi.mocked(query).mockResolvedValue([]);
    vi.mocked(queryOne).mockResolvedValueOnce(pinned).mockResolvedValueOnce({ result_hash: sha(JSON.stringify(payload)) });
    await expect(recordPrepareResult(request(), run, payload)).resolves.toMatchObject({ duplicate: true });
    vi.mocked(queryOne).mockResolvedValueOnce(pinned).mockResolvedValueOnce({ result_hash: sha(JSON.stringify(payload)) });
    await expect(recordPrepareResult(request(), run, { ...payload, reason: "Changed" })).rejects.toMatchObject({ status: 409 });
  });
  it("rejects late/replaced lease result when no matching completed result exists", async () => {
    vi.mocked(query).mockResolvedValue([]); vi.mocked(queryOne).mockResolvedValueOnce(pinned).mockResolvedValueOnce(null);
    await expect(recordPrepareResult(request(), run, { status: "failed", reason: "Late" })).rejects.toMatchObject({ status: 409 });
  });
});

describe("prepare payload integrity", () => {
  it("accepts exact PDF bytes", () => expect(() => validatePreparePdf(pdf, sha(pdf), pdf.byteLength)).not.toThrow());
  it.each([
    [pdf, "0".repeat(64), pdf.byteLength], [pdf, sha(pdf), pdf.byteLength + 1],
    [Buffer.from("<html>"), sha(Buffer.from("<html>")), 6], [pdf, sha(pdf), 10 * 1024 * 1024 + 1],
  ] as const)("rejects wrong hash, size, signature or excessive size", (bytes, digest, length) => {
    expect(() => validatePreparePdf(bytes, digest, length)).toThrow();
  });
  it.each([
    { status: "submitted", reason: "Unsupported" }, { status: "prepared", reason: " " },
    { status: ["prepared"], reason: "Wrong type" },
    { status: "prepared", reason: "x".repeat(1001) }, { status: "needs_human", reason: "Missing", missingQuestions: Array(51).fill("q") },
    { status: "needs_human", reason: "Missing", missingQuestions: ["x".repeat(501)] },
    { status: "prepared", reason: "Done", applicationStage: "applied" },
    { status: "failed", reason: "missing_required_answers", missingQuestions: ["Can you commute?"] },
    { status: "needs_human", reason: "missing_required_answers", missingQuestions: [] },
    { status: "needs_human", reason: "missing_required_answers", missingQuestions: ["x".repeat(401)] },
  ])("rejects unsafe or unbounded result %j", payload => expect(() => validatePrepareResult(payload)).toThrow());
});

describe("production fixture pilot", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("BROWSER_WORKER_PREPARE_ENABLED", "true");
    vi.stubEnv("BROWSER_WORKER_ENVIRONMENT", "production-pilot");
    vi.stubEnv("BROWSER_WORKER_PRODUCTION_PILOT_APPLICATION_ID", app);
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([undefined, "", "A#35322"])("fails closed with a missing or invalid application UUID (%s)", async applicationId => {
    vi.stubEnv("BROWSER_WORKER_PRODUCTION_PILOT_APPLICATION_ID", applicationId);
    await expect(claimPrepareApplication(request(), claimInput)).rejects.toMatchObject({ status: 404 });
    expect(queryOne).not.toHaveBeenCalled();
  });

  it("fails closed with a valid scope when the enable flag is off", async () => {
    vi.stubEnv("BROWSER_WORKER_PREPARE_ENABLED", "false");
    await expect(enrollPrepareApplication(enrollmentInput, app)).rejects.toMatchObject({ status: 404 });
    expect(queryOne).not.toHaveBeenCalled();
    expect(downloadResumeFile).not.toHaveBeenCalled();
  });

  it("rejects a different ticket before looking up or downloading its PDF", async () => {
    await expect(enrollPrepareApplication({ ...enrollmentInput, applicationId: job }, app))
      .rejects.toMatchObject({ status: 403, message: "Application is outside the production pilot scope" });
    expect(queryOne).not.toHaveBeenCalled();
    expect(downloadResumeFile).not.toHaveBeenCalled();
  });

  it("enrolls only the configured ticket through the existing PDF checks", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(source).mockResolvedValueOnce({ id: enrollment, expires_at: "2026-11-11T01:00:00Z" });
    vi.mocked(downloadResumeFile).mockResolvedValue({ buffer: pdf, contentType: "application/pdf" });
    await expect(enrollPrepareApplication(enrollmentInput, app)).resolves.toMatchObject({ enrollmentId: enrollment });
    expect(vi.mocked(queryOne).mock.calls[0][1]).toEqual([app, candidate, exportId]);
  });

  it.each([
    ["claim", () => claimPrepareApplication(request(), claimInput)],
    ["lease/facts", () => authorizeLivePrepareLease(request(), run)],
    ["artifact", () => getPrepareArtifact(request(), run)],
    ["result", () => recordPrepareResult(request(), run, { status: "prepared", reason: "fixture_final_review_ready" })],
  ] as const)("limits credential authentication for %s to the pilot ticket", async (_, operation) => {
    vi.mocked(queryOne).mockResolvedValueOnce(null);
    await expect(operation()).rejects.toMatchObject({ status: 401 });
    expect(queryOne).toHaveBeenCalledTimes(1);
    expect(queryOne).toHaveBeenCalledWith(expect.stringContaining("AND application_id = $2"), [sha(credential), app]);
    expect(query).not.toHaveBeenCalled();
  });

  it("restricts revocation to the pilot ticket", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null);
    await expect(revokePrepareEnrollment(enrollment, candidate)).resolves.toEqual({ revoked: false });
    expect(queryOne).toHaveBeenCalledTimes(1);
    expect(queryOne).toHaveBeenCalledWith(expect.stringContaining("AND application_id = $3"), [enrollment, candidate, app]);
  });

  it.each([
    { status: "prepared", reason: "final_review_ready" },
    { status: "needs_human", reason: "missing_required_answers", missingQuestions: ["Can you commute?"] },
    { status: "submitted", reason: "fixture_final_review_ready" },
  ])("rejects non-fixture or submitted results before writing them", async payload => {
    vi.mocked(queryOne).mockResolvedValueOnce(pinned);
    await expect(recordPrepareResult(request(), run, payload)).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
  });

  it("stores a fixture outcome only in the prepare run table", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(pinned);
    vi.mocked(query).mockResolvedValueOnce([{ id: run }]);
    const payload = { status: "needs_human", reason: "fixture_missing_required_answers", missingQuestions: ["Can you commute?"] };
    await expect(recordPrepareResult(request(), run, payload)).resolves.toMatchObject({ duplicate: false, status: "needs_human" });
    const [mutation, params] = vi.mocked(query).mock.calls[0];
    expect(mutation).toMatch(/^UPDATE browser_worker_prepare_runs/);
    expect(mutation).not.toMatch(/(?:UPDATE|INSERT INTO) (?:applications|application_stage_history|activity_logs)\b/);
    expect(params?.[4]).toBe(JSON.stringify(payload));
  });
});
