import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
vi.mock("@/lib/auth", () => ({ requireCurrentUser: vi.fn() }));
vi.mock("@/server/auth/jwt", () => ({ verifyJWT: vi.fn().mockResolvedValue(null) }));
vi.mock("@/server/db/neon", () => ({ query: vi.fn(), queryOne: vi.fn() }));
vi.mock("@/lib/resumeStorage", () => ({ downloadResumeFile: vi.fn() }));
import { requireCurrentUser } from "@/lib/auth";
import { queryOne } from "@/server/db/neon";
import { middleware } from "@/middleware";
import { POST as enroll } from "@/app/api/browser-worker/v2/enrollments/route";
import { POST as revoke } from "@/app/api/browser-worker/v2/enrollments/[id]/revoke/route";
import { POST as claim } from "@/app/api/browser-worker/v2/claims/route";
import { POST as pair } from "@/app/api/browser-worker/v2/pilot/enroll/route";
import { GET as getDevice, DELETE as revokeDevice } from "@/app/api/browser-worker/v2/pilot/device/route";
import { downloadResumeFile } from "@/lib/resumeStorage";
import { createHash } from "node:crypto";

describe("prepare route authentication and middleware", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("BROWSER_WORKER_PREPARE_ENABLED", "true"); vi.stubEnv("BROWSER_WORKER_ENVIRONMENT", "staging"); });
  afterEach(() => vi.unstubAllEnvs());
  it("lets only machine paths reach their credential handler without a session", async () => {
    for (const suffix of ["claims", "pilot/device", "runs/11111111-1111-4111-8111-111111111111/artifact", "runs/11111111-1111-4111-8111-111111111111/facts", "runs/11111111-1111-4111-8111-111111111111/result"]) {
      const result = await middleware(new NextRequest(`http://localhost/api/browser-worker/v2/${suffix}`));
      expect(result.headers.get("x-middleware-next")).toBe("1");
    }
    for (const suffix of ["enrollments", "enrollments/11111111-1111-4111-8111-111111111111/revoke", "pilot/enroll", "arbitrary"]) {
      expect((await middleware(new NextRequest(`http://localhost/api/browser-worker/v2/${suffix}`))).status).toBe(401);
    }
  });
  it("handler rejects anonymous machine requests", async () => {
    const result = await claim(new Request("http://localhost/api/browser-worker/v2/claims", { method: "POST", body: "{}" }));
    expect(result.status).toBe(401); expect(queryOne).not.toHaveBeenCalled();
    expect(result.headers.get("cache-control")).toBe("no-store, private");
  });
  it("does not expose worker routes while disabled", async () => {
    vi.stubEnv("BROWSER_WORKER_PREPARE_ENABLED", "false");
    expect((await claim(new Request("http://localhost/api/browser-worker/v2/claims", { method: "POST", body: "{}" }))).status).toBe(404);
    expect(queryOne).not.toHaveBeenCalled();
  });
  it("requires admin or manager operator session before enrollment reads", async () => {
    vi.mocked(requireCurrentUser).mockResolvedValue({ context: null, response: NextResponse.json({ error: "Permission denied" }, { status: 403 }) });
    expect((await enroll(new Request("http://localhost/api/browser-worker/v2/enrollments", { method: "POST", body: "{}" }))).status).toBe(403);
    expect(requireCurrentUser).toHaveBeenCalledWith(["admin", "manager"]); expect(queryOne).not.toHaveBeenCalled();
  });
});

const applicationId = "11111111-1111-4111-8111-111111111111";
const candidateId = "22222222-2222-4222-8222-222222222222";
const exportId = "33333333-3333-4333-8333-333333333333";
const enrollmentId = "44444444-4444-4444-8444-444444444444";
const operatorId = "55555555-5555-4555-8555-555555555555";
const canonicalOrigin = "https://talentos.example.test";

describe("production pilot device pairing", () => {
  const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
  const token = `tbw_${"a".repeat(64)}`;
  const credentialHash = sha(token);
  const pairingCode = credentialHash.slice(0, 8).toUpperCase();
  const profileVersion = "local-v1";
  const expiresAt = () => Date.now() + 120_000;
  const pairRequest = (overrides = {}, origin: string | null = canonicalOrigin) => new Request("http://localhost:3000/api/browser-worker/v2/pilot/enroll", {
    method: "POST", headers: origin === null ? {} : { Origin: origin },
    body: JSON.stringify({ applicationId, candidateId, exportId, profileVersion, credentialHash, pairingCode, expiresAt: expiresAt(), ...overrides }),
  });
  const deviceRequest = (authorization?: string) => new Request(`${canonicalOrigin}/api/browser-worker/v2/pilot/device`, {
    headers: authorization ? { Authorization: authorization } : {},
  });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TALENTOS_BASE_URL", canonicalOrigin);
    vi.stubEnv("BROWSER_WORKER_PREPARE_ENABLED", "true");
    vi.stubEnv("BROWSER_WORKER_ENVIRONMENT", "production-pilot");
    vi.stubEnv("BROWSER_WORKER_PRODUCTION_PILOT_APPLICATION_ID", applicationId);
    vi.mocked(requireCurrentUser).mockResolvedValue({ response: null, context: {
      user: { id: operatorId, email: null },
      profile: { user_id: operatorId, email: null, display_name: "Test Manager", role: "manager", is_active: true },
    } });
    vi.mocked(queryOne).mockResolvedValue(null);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("preserves existing enrollment input validation", async () => {
    const response = await enroll(pairRequest());
    expect(response.status).toBe(400);
    expect(queryOne).not.toHaveBeenCalled();
  });

  it("requires a signed-in admin or manager and the actual browser origin", async () => {
    expect((await pair(pairRequest({}, "https://untrusted.example.test"))).status).toBe(403);
    expect((await pair(pairRequest({}, null))).status).toBe(403);
    vi.mocked(requireCurrentUser).mockResolvedValue({ context: null, response: NextResponse.json({}, { status: 403 }) });
    expect((await pair(pairRequest())).status).toBe(403);
    expect(requireCurrentUser).toHaveBeenCalledWith(["admin", "manager"]);
    expect(queryOne).not.toHaveBeenCalled();
  });

  it.each([
    [{ applicationId: candidateId }, 403], [{ pairingCode: "DEADBEEF" }, 400], [{ credentialHash: token }, 400],
    [{ expiresAt: 1 }, 400], [{ expiresAt: Number.MAX_SAFE_INTEGER }, 400],
  ] as const)("rejects out-of-scope or invalid pairing %j", async (change, status) => {
    expect((await pair(pairRequest(change))).status).toBe(status);
    expect(queryOne).not.toHaveBeenCalled();
  });

  it("persists only the submitted hash and a bounded expiry after validating the exact archived PDF", async () => {
    const pdf = Buffer.from("%PDF-pilot");
    const expiry = expiresAt();
    vi.mocked(downloadResumeFile).mockResolvedValue({ buffer: pdf, contentType: "application/pdf" });
    vi.mocked(queryOne).mockResolvedValueOnce({
      application_id: applicationId, candidate_id: candidateId, job_id: candidateId, export_id: exportId,
      resume_version_id: exportId, content_sha256: sha(pdf), byte_length: pdf.length,
      storage_provider: "r2", file_path: "fixture.pdf", storage_url: null,
      job_snapshot: {}, resume_snapshot: {}, job_url: "https://www.linkedin.com/jobs/view/1/",
    }).mockResolvedValueOnce({ id: enrollmentId, expires_at: new Date(expiry).toISOString() });
    const response = await pair(pairRequest({ expiresAt: expiry }));
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    await expect(response.json()).resolves.toEqual({ enrollmentId, expiresAt: new Date(expiry).toISOString() });
    expect(vi.mocked(queryOne).mock.calls[0][1]).toEqual([applicationId, candidateId, exportId]);
    const [sql, params] = vi.mocked(queryOne).mock.calls[1];
    expect(sql).toMatch(/FOR UPDATE OF a, j, v, x/);
    expect(params?.slice(13)).toEqual([credentialHash, operatorId, "{}", new Date(expiry).toISOString()]);
  });

  it("checks the exact ticket queue state with the raw worker key and revokes only that enrollment", async () => {
    expect((await getDevice(deviceRequest())).status).toBe(401);
    expect((await revokeDevice(deviceRequest(`Bearer ${credentialHash}`))).status).toBe(401);
    expect(queryOne).not.toHaveBeenCalled();
    expect((await getDevice(deviceRequest(`Bearer ${token}`))).status).toBe(401);
    const snapshot = { enrollmentId, applicationId, queueState: { stage: "ready_for_application", appliedAt: null } };
    vi.mocked(queryOne).mockResolvedValueOnce(snapshot).mockResolvedValueOnce({ id: enrollmentId });
    const response = await getDevice(deviceRequest(`Bearer ${token}`));
    await expect(response.json()).resolves.toEqual(snapshot);
    const revocation = await revokeDevice(deviceRequest(`Bearer ${token}`));
    await expect(revocation.json()).resolves.toEqual({ revoked: true });
    for (const [, params] of vi.mocked(queryOne).mock.calls) expect(params).toEqual([credentialHash, applicationId]);
    expect(vi.mocked(queryOne).mock.calls[2][0]).toMatch(/^UPDATE browser_worker_prepare_enrollments/);
  });

  it.each(["staging", "disabled"])("keeps device routes closed in %s", async environment => {
    vi.stubEnv("BROWSER_WORKER_ENVIRONMENT", environment);
    expect((await pair(pairRequest())).status).toBe(404);
    expect((await getDevice(deviceRequest(`Bearer ${token}`))).status).toBe(404);
    expect((await revokeDevice(deviceRequest(`Bearer ${token}`))).status).toBe(404);
    expect(queryOne).not.toHaveBeenCalled();
  });
});

describe.each([
  { action: "enrollment", suffix: "", handler: enroll, allowedStatus: 409 },
  {
    action: "revocation", suffix: `/${enrollmentId}/revoke`,
    handler: (request: Request) => revoke(request, { params: { id: enrollmentId } }), allowedStatus: 200,
  },
])("$action operator origin", ({ suffix, handler, allowedStatus }) => {
  const request = (url: string, headers?: Record<string, string>) => new Request(`${url}/api/browser-worker/v2/enrollments${suffix}`, {
    method: "POST", headers,
    body: JSON.stringify({ applicationId, candidateId, exportId, profileRef: candidateId, profileVersion: "local-v1" }),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TALENTOS_BASE_URL", canonicalOrigin);
    vi.stubEnv("APP_BASE_URL", undefined);
    vi.stubEnv("BROWSER_WORKER_PREPARE_ENABLED", "true");
    vi.stubEnv("BROWSER_WORKER_ENVIRONMENT", "production-pilot");
    vi.stubEnv("BROWSER_WORKER_PRODUCTION_PILOT_APPLICATION_ID", applicationId);
    vi.mocked(requireCurrentUser).mockResolvedValue({ response: null, context: {
      user: { id: operatorId, email: null },
      profile: { user_id: operatorId, email: null, display_name: "Test Manager", role: "manager", is_active: true },
    } });
    vi.mocked(queryOne).mockResolvedValue(null);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("accepts the public browser origin when the request URL contains the proxy's internal origin", async () => {
    const response = await handler(request("http://localhost:3000", { Origin: canonicalOrigin }));
    expect(response.status).toBe(allowedStatus);
    expect(requireCurrentUser).toHaveBeenCalledWith(["admin", "manager"]);
    expect(queryOne).toHaveBeenCalledTimes(1);
  });

  it("accepts an authenticated terminal request without Origin", async () => {
    const response = await handler(request("http://localhost:3000"));
    expect(response.status).toBe(allowedStatus);
    expect(requireCurrentUser).toHaveBeenCalledWith(["admin", "manager"]);
    expect(queryOne).toHaveBeenCalledTimes(1);
  });

  it.each(["https://untrusted.example.test", "", "null"])("rejects an untrusted Origin even with forwarded headers (%s)", async origin => {
    const untrustedUrl = "https://untrusted.example.test";
    const response = await handler(request(untrustedUrl, {
      Origin: origin,
      Forwarded: "host=untrusted.example.test;proto=https",
      "X-Forwarded-Host": "untrusted.example.test",
      "X-Forwarded-Proto": "https",
    }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Same-origin operator request required" });
    expect(queryOne).not.toHaveBeenCalled();
  });

  it("permits an unconfigured local development origin on a dynamic port", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("TALENTOS_BASE_URL", undefined);
    const localOrigin = "http://localhost:34567";
    const response = await handler(request(localOrigin, { Origin: localOrigin }));
    expect(response.status).toBe(allowedStatus);
    expect(queryOne).toHaveBeenCalledTimes(1);
  });

  it("fails closed for a browser when production's canonical origin is missing", async () => {
    vi.stubEnv("TALENTOS_BASE_URL", undefined);
    const response = await handler(request(canonicalOrigin, { Origin: canonicalOrigin }));
    expect(response.status).toBe(500);
    expect(queryOne).not.toHaveBeenCalled();
  });
});
