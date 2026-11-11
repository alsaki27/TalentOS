import { createHash, randomBytes } from "node:crypto";
import { query, queryOne } from "@/server/db/neon";
import { downloadResumeFile } from "@/lib/resumeStorage";

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

export class BrowserWorkerPrepareError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
type PrepareScope = { mode: "staging" } | { mode: "production-pilot"; applicationId: string };

export function assertBrowserWorkerPrepareEnabled(): PrepareScope {
  if (process.env.BROWSER_WORKER_PREPARE_ENABLED === "true") {
    if (process.env.BROWSER_WORKER_ENVIRONMENT === "staging") return { mode: "staging" };
    const applicationId = process.env.BROWSER_WORKER_PRODUCTION_PILOT_APPLICATION_ID;
    if (process.env.BROWSER_WORKER_ENVIRONMENT === "production-pilot" && applicationId && UUID.test(applicationId)) {
      return { mode: "production-pilot", applicationId: applicationId.toLowerCase() };
    }
  }
  throw new BrowserWorkerPrepareError(404, "Browser worker prepare integration is disabled");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BrowserWorkerPrepareError(400, "Expected a JSON object");
  return value as Record<string, unknown>;
}
function id(value: unknown, name: string, uuid = false): string {
  if (typeof value !== "string" || !(uuid ? UUID : ID).test(value)) throw new BrowserWorkerPrepareError(400, `Invalid ${name}`);
  return value;
}
function allowedKeys(body: Record<string, unknown>, keys: string[]) {
  if (Object.keys(body).some(key => !keys.includes(key))) throw new BrowserWorkerPrepareError(400, "Unknown request field");
}
export async function readPrepareJson(request: Request): Promise<unknown> {
  const maxBytes = 32_768;
  const tooLarge = () => new BrowserWorkerPrepareError(413, "Request body exceeds 32 KiB");
  if (Number(request.headers.get("content-length")) > maxBytes) throw tooLarge();
  if (!request.body) throw new BrowserWorkerPrepareError(400, "Invalid JSON");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        throw tooLarge();
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  try { return JSON.parse(text); } catch { throw new BrowserWorkerPrepareError(400, "Invalid JSON"); }
}
export function validatePreparePdf(bytes: Uint8Array, sha256: string, byteLength: number): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 5 || byteLength > MAX_PDF_BYTES || bytes.byteLength !== byteLength ||
    Buffer.from(bytes.subarray(0, 5)).toString("ascii") !== "%PDF-" || !/^[a-f0-9]{64}$/.test(sha256) || hash(bytes) !== sha256) {
    throw new BrowserWorkerPrepareError(409, "Pinned PDF bytes, size or SHA-256 do not match");
  }
}

interface Enrollment {
  id: string; application_id: string; candidate_id: string; job_id: string; export_id: string;
  resume_version_id: string; profile_ref: string; profile_version: string; job_version: string;
  job_snapshot: unknown; job_url: string; content_sha256: string; byte_length: number;
}
interface Source {
  application_id: string; candidate_id: string; job_id: string; export_id: string; resume_version_id: string;
  content_sha256: string; byte_length: number; storage_provider: string; file_path: string; storage_url: string | null;
  job_snapshot: unknown; resume_snapshot: unknown; job_url: string;
}
// This is an additional, conservative prepare-enrollment eligibility check. It
// does not replace or modify the existing Application Queue's filters.
const SOURCE_JOINS = `FROM applications a
  JOIN jobs j ON j.id = a.job_id
  JOIN application_resume_versions v ON v.id = a.tailored_resume_version_id
    AND v.candidate_id = a.candidate_id AND v.target_job_id = a.job_id
  JOIN application_resume_exports x ON x.application_id = a.id AND x.resume_version_id = v.id`;
const READY = `COALESCE(a.application_stage, a.ae_stage) = 'ready_for_application'
  AND a.applied_at IS NULL AND COALESCE(a.review_status, 'approved') IN ('approved', 'not_required')
  AND j.is_active = true AND v.status = 'approved'
  AND x.status = 'created' AND x.export_type = 'pdf'
  AND x.content_sha256 ~ '^[a-f0-9]{64}$'
  AND x.file_size_bytes BETWEEN 5 AND ${MAX_PDF_BYTES}`;
const BOUND = `${READY}
  AND a.id = e.application_id AND a.candidate_id = e.candidate_id AND a.job_id = e.job_id
  AND v.id = e.resume_version_id AND x.id = e.export_id
  AND x.content_sha256 = e.content_sha256 AND x.file_size_bytes = e.byte_length
  AND to_jsonb(j) = e.job_snapshot AND to_jsonb(v) = e.resume_snapshot`;
const BOUND_JOINS = `JOIN applications a ON a.id = e.application_id
  JOIN jobs j ON j.id = a.job_id
  JOIN application_resume_versions v ON v.id = a.tailored_resume_version_id
    AND v.candidate_id = a.candidate_id AND v.target_job_id = a.job_id
  JOIN application_resume_exports x ON x.id = e.export_id AND x.application_id = a.id AND x.resume_version_id = v.id`;

/** Staff route supplies the authenticated operator, never a caller-provided actor. */
export async function enrollPrepareApplication(input: unknown, actorId: string) {
  const scope = assertBrowserWorkerPrepareEnabled();
  const body = object(input);
  allowedKeys(body, ["applicationId", "candidateId", "exportId", "profileRef", "profileVersion"]);
  const applicationId = id(body.applicationId, "applicationId", true);
  if (scope.mode === "production-pilot" && applicationId.toLowerCase() !== scope.applicationId) {
    throw new BrowserWorkerPrepareError(403, "Application is outside the production pilot scope");
  }
  const candidateId = id(body.candidateId, "candidateId", true);
  const exportId = id(body.exportId, "exportId", true);
  const profileRef = id(body.profileRef, "profileRef");
  const profileVersion = id(body.profileVersion, "profileVersion");
  if (profileRef !== candidateId) throw new BrowserWorkerPrepareError(400, "profileRef must equal candidateId");
  const source = await queryOne<Source>(`SELECT a.id AS application_id, a.candidate_id, a.job_id,
    x.id AS export_id, v.id AS resume_version_id, x.content_sha256, x.file_size_bytes::integer AS byte_length,
    x.storage_provider, x.file_path, x.storage_url, to_jsonb(j) AS job_snapshot, to_jsonb(v) AS resume_snapshot,
    COALESCE(NULLIF(j.apply_url, ''), j.source_url) AS job_url
    ${SOURCE_JOINS} WHERE a.id = $1 AND a.candidate_id = $2 AND x.id = $3 AND ${READY}`,
    [applicationId, candidateId, exportId]);
  if (!source) throw new BrowserWorkerPrepareError(409, "Application must be ready with its selected approved archived PDF");
  let jobUrl: URL;
  try { jobUrl = new URL(source.job_url); } catch { throw new BrowserWorkerPrepareError(409, "Job has no valid application URL"); }
  if (!["https:", "http:"].includes(jobUrl.protocol) || jobUrl.username || jobUrl.password || jobUrl.hash) throw new BrowserWorkerPrepareError(409, "Job URL must use HTTP(S) without credentials or fragments");
  if (!((source.storage_provider === "sharepoint" && source.storage_url) || (source.storage_provider === "r2" && source.file_path))) {
    throw new BrowserWorkerPrepareError(409, "An archived SharePoint or R2 PDF is required; regeneration is not allowed");
  }
  const { buffer } = await downloadResumeFile(source.storage_provider, source.file_path, source.storage_url);
  validatePreparePdf(buffer, source.content_sha256, source.byte_length);
  const credential = `tbw_${randomBytes(32).toString("hex")}`;
  // Recheck identity/readiness after storage IO, and lock joined source rows
  // until the verified immutable snapshot insert has completed atomically.
  const enrollment = await queryOne<{ id: string; expires_at: string }>(`WITH eligible AS (
    SELECT a.id ${SOURCE_JOINS} WHERE a.id = $1 AND a.candidate_id = $2 AND x.id = $3 AND ${READY}
      AND x.content_sha256 = $4 AND x.file_size_bytes = $5 AND v.id = $6
      AND to_jsonb(j) = $7::jsonb AND to_jsonb(v) = $16::jsonb FOR UPDATE OF a, j, v, x
    ) INSERT INTO browser_worker_prepare_enrollments
      (application_id,candidate_id,job_id,export_id,resume_version_id,profile_ref,profile_version,
       job_version,job_snapshot,resume_snapshot,job_url,content_sha256,byte_length,artifact_bytes,credential_hash,created_by,expires_at)
      SELECT $1,$2,$8,$3,$6,$9,$10,$11,$7::jsonb,$16::jsonb,$12,$4,$5,decode($13,'base64'),$14,$15,now() + interval '24 hours'
      FROM eligible ON CONFLICT DO NOTHING RETURNING id, expires_at`,
    [applicationId, candidateId, exportId, source.content_sha256, source.byte_length, source.resume_version_id,
      JSON.stringify(source.job_snapshot), source.job_id, profileRef, profileVersion, hash(JSON.stringify(source.job_snapshot)),
      source.job_url, Buffer.from(buffer).toString("base64"), hash(credential), actorId, JSON.stringify(source.resume_snapshot)]);
  if (!enrollment) throw new BrowserWorkerPrepareError(409, "Source changed or candidate already enrolled; revoke the existing enrollment before replacing it");
  return { enrollmentId: enrollment.id, credential, expiresAt: enrollment.expires_at };
}

export async function revokePrepareEnrollment(enrollmentId: string, actorId: string) {
  const scope = assertBrowserWorkerPrepareEnabled();
  const params = [id(enrollmentId, "enrollmentId", true), actorId];
  if (scope.mode === "production-pilot") params.push(scope.applicationId);
  const row = await queryOne(`UPDATE browser_worker_prepare_enrollments SET revoked_at = now(), revoked_by = $2
    WHERE id = $1 AND revoked_at IS NULL${scope.mode === "production-pilot" ? " AND application_id = $3" : ""} RETURNING id`, params);
  return { revoked: Boolean(row) };
}

async function authenticate(request: Request): Promise<{ enrollment: Enrollment; scope: PrepareScope }> {
  const scope = assertBrowserWorkerPrepareEnabled();
  const auth = request.headers.get("authorization") || "";
  if (!/^Bearer tbw_[a-f0-9]{64}$/.test(auth)) throw new BrowserWorkerPrepareError(401, "Valid scoped worker credential required");
  const params = [hash(auth.slice(7))];
  if (scope.mode === "production-pilot") params.push(scope.applicationId);
  const enrollment = await queryOne<Enrollment>(`SELECT id, application_id, candidate_id, job_id, export_id,
    resume_version_id, profile_ref, profile_version, job_version, job_snapshot, job_url, content_sha256, byte_length
    FROM browser_worker_prepare_enrollments WHERE credential_hash = $1 AND revoked_at IS NULL AND expires_at > now()
    ${scope.mode === "production-pilot" ? "AND application_id = $2" : ""}`, params);
  if (!enrollment) throw new BrowserWorkerPrepareError(401, "Worker credential is expired, revoked or invalid");
  return { enrollment, scope };
}
function leaseHash(request: Request) {
  const token = request.headers.get("x-browser-worker-lease") || "";
  if (!/^tbl_[a-f0-9]{64}$/.test(token)) throw new BrowserWorkerPrepareError(409, "Valid worker lease required");
  return hash(token);
}
function manifest(e: Enrollment) {
  return { version: 1, mode: "prepare", applicationId: e.application_id, candidateId: e.candidate_id,
    jobId: e.job_id, effectiveStage: "ready_for_application", profileRef: e.profile_ref,
    profileVersion: e.profile_version, jobVersion: e.job_version,
    artifact: { exportId: e.export_id, resumeVersionId: e.resume_version_id, sha256: e.content_sha256,
      byteLength: e.byte_length, contentType: "application/pdf" } };
}
export async function claimPrepareApplication(request: Request, input: unknown) {
  const { enrollment: e } = await authenticate(request);
  const body = object(input);
  allowedKeys(body, ["candidateId", "profileRef", "profileVersion"]);
  if (id(body.candidateId, "candidateId", true) !== e.candidate_id || id(body.profileRef, "profileRef") !== e.profile_ref ||
    id(body.profileVersion, "profileVersion") !== e.profile_version) throw new BrowserWorkerPrepareError(403, "Credential candidate/profile binding mismatch");
  const leaseToken = `tbl_${randomBytes(32).toString("hex")}`;
  const run = await queryOne<{ id: string; lease_expires_at: string }>(`WITH eligible AS (
    SELECT e.id FROM browser_worker_prepare_enrollments e ${BOUND_JOINS}
    WHERE e.id = $1 AND e.revoked_at IS NULL AND e.expires_at > now() AND ${BOUND}
    FOR UPDATE OF e, a, j, v, x
    ) INSERT INTO browser_worker_prepare_runs (enrollment_id,lease_token_hash,lease_expires_at)
      SELECT id,$2,now() + interval '5 minutes' FROM eligible
    ON CONFLICT (enrollment_id) DO UPDATE SET lease_token_hash = EXCLUDED.lease_token_hash,
      lease_expires_at = EXCLUDED.lease_expires_at, attempt = browser_worker_prepare_runs.attempt + 1, updated_at = now()
      WHERE browser_worker_prepare_runs.status = 'leased' AND browser_worker_prepare_runs.lease_expires_at <= now()
    RETURNING id,lease_expires_at`, [e.id, hash(leaseToken)]);
  if (!run) return null;
  return { runId: run.id, leaseToken, leaseExpiresAt: run.lease_expires_at, jobUrl: e.job_url, manifest: manifest(e) };
}

/** Scope, lease and current readiness are rechecked; caller cannot select another candidate/job. */
export async function authorizeLivePrepareLease(request: Request, runId: string) {
  const { enrollment: e } = await authenticate(request);
  const run = await queryOne(`SELECT r.id FROM browser_worker_prepare_runs r
    JOIN browser_worker_prepare_enrollments e ON e.id = r.enrollment_id ${BOUND_JOINS}
    WHERE r.id = $1 AND e.id = $2 AND r.lease_token_hash = $3 AND r.status = 'leased'
      AND r.lease_expires_at > now() AND e.revoked_at IS NULL AND e.expires_at > now() AND ${BOUND}`,
    [id(runId, "runId", true), e.id, leaseHash(request)]);
  if (!run) throw new BrowserWorkerPrepareError(409, "Lease expired, completed, replaced, or application snapshot is no longer ready");
  return { runId, enrollmentId: e.id, candidateId: e.candidate_id, jobId: e.job_id, manifest: manifest(e) };
}
export async function getPrepareArtifact(request: Request, runId: string) {
  const context = await authorizeLivePrepareLease(request, runId);
  const stored = await queryOne<{ artifact: string }>(`SELECT encode(artifact_bytes,'base64') AS artifact
    FROM browser_worker_prepare_enrollments WHERE id = $1`, [context.enrollmentId]);
  if (!stored) throw new BrowserWorkerPrepareError(409, "Pinned artifact unavailable");
  const bytes = Buffer.from(stored.artifact, "base64");
  validatePreparePdf(bytes, context.manifest.artifact.sha256, context.manifest.artifact.byteLength);
  await authorizeLivePrepareLease(request, runId);
  return bytes;
}

export interface PrepareResult { status: "prepared" | "needs_human" | "failed"; reason: string; missingQuestions?: string[] }
export function validatePrepareResult(input: unknown): PrepareResult {
  const body = object(input);
  allowedKeys(body, ["status", "reason", "missingQuestions"]);
  if (body.status !== "prepared" && body.status !== "needs_human" && body.status !== "failed") {
    throw new BrowserWorkerPrepareError(400, "Only prepare outcomes are accepted");
  }
  if (typeof body.reason !== "string" || !body.reason.trim() || body.reason.length > 1000) throw new BrowserWorkerPrepareError(400, "reason must contain 1 to 1000 characters");
  if (body.missingQuestions !== undefined && (!Array.isArray(body.missingQuestions) || body.missingQuestions.length > 50 ||
    body.missingQuestions.some(q => typeof q !== "string" || !q.trim() || q.length > 500))) throw new BrowserWorkerPrepareError(400, "missingQuestions must contain at most 50 questions of 1 to 500 characters");
  const reason = body.reason.trim();
  const missingQuestions = (body.missingQuestions as string[] | undefined)?.map(q => q.trim());
  if (reason === "missing_required_answers" && (body.status !== "needs_human" || !missingQuestions?.length ||
    missingQuestions.some(question => question.replace(/\s+/g, " ").length > 400))) {
    throw new BrowserWorkerPrepareError(400, "Screening question requests require needs_human and labels of 1 to 400 characters");
  }
  return { status: body.status, reason, ...(missingQuestions === undefined ? {} : { missingQuestions }) };
}
export async function recordPrepareResult(request: Request, runId: string, input: unknown) {
  const { enrollment: e, scope } = await authenticate(request);
  const result = validatePrepareResult(input);
  if (scope.mode === "production-pilot" && !/^fixture_[a-z0-9_]+$/.test(result.reason)) {
    throw new BrowserWorkerPrepareError(400, "Production pilot accepts only fixture outcomes");
  }
  const resultHash = hash(JSON.stringify(result));
  const tokenHash = leaseHash(request);
  const params = [id(runId, "runId", true), e.id, tokenHash, result.status, JSON.stringify(result), resultHash];
  const rows = await query<{ id: string }>(`UPDATE browser_worker_prepare_runs r SET status = $4,
    result = $5::jsonb, result_hash = $6, completed_at = now(), updated_at = now()
    WHERE r.id = $1 AND r.enrollment_id = $2 AND r.lease_token_hash = $3 AND r.status = 'leased'
      AND r.lease_expires_at > now() AND EXISTS (SELECT 1 FROM browser_worker_prepare_enrollments e
        WHERE e.id = r.enrollment_id AND e.revoked_at IS NULL AND e.expires_at > now())
      AND (($4 <> 'prepared' AND $5::jsonb->>'reason' <> 'missing_required_answers') OR EXISTS (SELECT 1 FROM browser_worker_prepare_enrollments e ${BOUND_JOINS}
        WHERE e.id = r.enrollment_id AND ${BOUND})) RETURNING r.id`, params);
  if (rows.length) return { runId, status: result.status, duplicate: false };
  const previous = await queryOne<{ result_hash: string }>(`SELECT r.result_hash FROM browser_worker_prepare_runs r
    JOIN browser_worker_prepare_enrollments e ON e.id = r.enrollment_id
    WHERE r.id = $1 AND r.enrollment_id = $2 AND r.lease_token_hash = $3 AND r.status <> 'leased'
      AND e.revoked_at IS NULL AND e.expires_at > now()`, params.slice(0, 3));
  if (previous?.result_hash === resultHash) return { runId, status: result.status, duplicate: true };
  throw new BrowserWorkerPrepareError(409, "Result conflicts with completed, expired, replaced or stale run");
}
