import { createHash, randomBytes } from "node:crypto";
import { RESUME_EVIDENCE_VARIANT } from "@/lib/ai/application-agents/workflowStages";
import { BROWSER_QUEUE_JOB_URL_SQL as JOB_URL } from "@/lib/browserWorkerQueuePosting";
import { downloadResumeFile } from "@/lib/resumeStorage";
import { query, queryOne } from "@/server/db/neon";
import { findExportById } from "@/server/repositories/applicationResumeExportsRepository";
import { TEMPORARY_RESUME_PDF_PROVIDER } from "@/server/storage/approvedResumePdfStorage";
import { readApprovedResumePdf } from "./approvedResumePdfDownload";
import { getApprovedApplicationAnswers } from "./candidateApplicationFactsService";

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CONTROL_CHARACTER = new RegExp("\\p{Cc}", "u");
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

export class BrowserWorkerQueueError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export function assertBrowserWorkerQueueEnabled() {
  if (process.env.BROWSER_WORKER_QUEUE_ENABLED !== "true") {
    throw new BrowserWorkerQueueError(404, "Dedicated browser worker queue is disabled");
  }
}

function queueObject(input: unknown, keys: string[]) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some(key => !keys.includes(key))) {
    throw new BrowserWorkerQueueError(400, "Invalid request fields");
  }
  return input as Record<string, unknown>;
}

function queueUuid(value: unknown, field: string) {
  if (typeof value !== "string" || !UUID.test(value)) throw new BrowserWorkerQueueError(400, `Invalid ${field}`);
  return value.toLowerCase();
}

type ResultStatus = "prepared" | "needs_human" | "failed";
interface QueueResult { status: ResultStatus; reason: string; missingQuestions?: string[] }

interface QueueJob {
  id: string;
  application_id: string;
  candidate_id: string;
  job_id: string;
  worker_id: string;
  requested_by: string;
  status: "queued" | "leased" | "submission_unknown" | ResultStatus;
  attempt: number;
  created_at: string;
  completed_at: string | null;
  lease_expires_at: string | null;
  result: QueueResult | null;
}

interface JobClaim extends QueueJob {
  lease_expires_at: string;
  job_url: string;
  expected_dialog_heading: string;
  job_version: string;
  export_id: string;
  resume_version_id: string;
  content_sha256: string;
  byte_length: number;
  profile_version: string;
}

type ClaimWithResumeNaming = JobClaim & { candidate_name?: string | null; job_title?: string | null };

function resumeNamingLabel(value: string | null | undefined) {
  if (!value) return undefined;
  const label = value.trim().replace(/\s+/g, " ");
  return label && label.length <= 200 && !CONTROL_CHARACTER.test(label) ? label : undefined;
}

const SELECTED_RESUME_JOIN = `JOIN application_resume_versions v ON v.id = a.tailored_resume_version_id
  AND v.candidate_id = a.candidate_id
  AND (v.application_id IS NULL OR v.application_id = a.id)
  AND (v.job_id IS NULL OR v.job_id = a.job_id)
  AND (
    EXISTS (SELECT 1 FROM target_jobs t WHERE t.id = v.target_job_id AND t.candidate_id = a.candidate_id AND t.job_id = a.job_id)
    OR (v.target_job_id = a.job_id AND NOT EXISTS (SELECT 1 FROM target_jobs t WHERE t.id = v.target_job_id))
  )`;
const SOURCE_JOINS = `JOIN candidates c ON c.id = a.candidate_id
  JOIN jobs j ON j.id = a.job_id ${SELECTED_RESUME_JOIN}
  JOIN LATERAL (
    SELECT archived.* FROM application_resume_exports archived
    WHERE archived.application_id = a.id AND archived.resume_version_id = v.id
      AND archived.status = 'created' AND archived.export_type = 'pdf'
      AND archived.content_sha256 ~ '^[a-f0-9]{64}$' AND archived.file_size_bytes BETWEEN 5 AND 1999999
      AND (NOT EXISTS (
        SELECT 1 FROM application_ai_workflows w WHERE w.id = a.ai_workflow_id
          AND w.config_snapshot->>'pipelineVariant' = '${RESUME_EVIDENCE_VARIANT}'
      ) OR (
        v.workflow_id = a.ai_workflow_id
        AND archived.id::text = to_jsonb(v)->'release_receipt'->>'exportId'
        AND archived.content_sha256 = to_jsonb(v)->'release_receipt'->>'pdfHash'
      ))
      AND ((archived.storage_provider = 'sharepoint' AND NULLIF(archived.storage_url, '') IS NOT NULL)
        OR (archived.storage_provider IN ('r2', '${TEMPORARY_RESUME_PDF_PROVIDER}') AND NULLIF(archived.file_path, '') IS NOT NULL))
    ORDER BY COALESCE(archived.updated_at, archived.created_at) DESC NULLS LAST, archived.id DESC LIMIT 1
  ) x ON true`;
const DIALOG_HEADING = `'Apply to ' || BTRIM(j.company)`;
const JOB_VERSION = `encode(sha256(convert_to(to_jsonb(j)::text, 'UTF8')), 'hex')`;
// Archive refresh bookkeeping can finish after the approved PDF is published.
// Keep the saved document, approval receipt, and ownership bound to this run.
const RESUME_VERSION = `encode(sha256(convert_to(
  (to_jsonb(v) - ARRAY['updated_at', 'pdf_refresh_state', 'pdf_refresh_error'])::text, 'UTF8')), 'hex')`;
const READY = `COALESCE(a.application_stage, a.ae_stage) = 'ready_for_application'
  AND a.status IN ('assigned','in_progress','stacked') AND a.applied_at IS NULL AND a.ae_applied_at IS NULL
  AND a.review_status IN ('approved','not_required')
  AND c.status = 'active' AND c.pipeline_stage = 'applying'
  AND j.is_active = true AND v.status = 'approved'
  AND octet_length(BTRIM(j.company)) BETWEEN 1 AND 160 AND j.company !~ '[[:cntrl:]]'
  AND ${JOB_URL} IS NOT NULL`;
const BOUND_JOINS = `JOIN applications a ON a.id = q.application_id ${SOURCE_JOINS}`;
const BOUND = `${READY}
  AND a.candidate_id = q.candidate_id AND a.job_id = q.job_id
  AND ${JOB_URL} = q.job_url AND (${DIALOG_HEADING}) = q.expected_dialog_heading
  AND ${JOB_VERSION} = q.job_version AND ${RESUME_VERSION} = q.resume_revision
  AND x.id = q.export_id AND v.id = q.resume_version_id
  AND x.content_sha256 = q.content_sha256 AND x.file_size_bytes = q.byte_length`;
const expiredResult = (reason: string): QueueResult => ({ status: "failed", reason });

function publicJob(job: QueueJob) {
  return {
    requestId: job.id, applicationId: job.application_id, candidateId: job.candidate_id, jobId: job.job_id,
    workerId: job.worker_id, requestedBy: job.requested_by, status: job.status, attempt: job.attempt,
    createdAt: job.created_at, leaseExpiresAt: job.lease_expires_at, completedAt: job.completed_at, result: job.result,
  };
}

export async function registerBrowserQueueWorker(input: unknown, actor: string) {
  const { label } = queueObject(input, ["label"]);
  if (typeof label !== "string" || label.trim().length === 0 || label.trim().length > 100) {
    throw new BrowserWorkerQueueError(400, "Worker label must contain 1 to 100 characters");
  }
  const credential = `tbwq_${randomBytes(32).toString("hex")}`;
  const row = await queryOne<{ id: string }>(
    `INSERT INTO browser_worker_queue_workers (label, credential_hash, registered_by)
     VALUES ($1, $2, $3) RETURNING id`, [label.trim(), sha(credential), actor],
  );
  if (!row) throw new BrowserWorkerQueueError(500, "Worker registration failed");
  return { workerId: row.id, credential };
}

export async function revokeBrowserQueueWorker(value: unknown, actor: string) {
  const workerId = queueUuid(value, "worker ID");
  const result = expiredResult("worker_revoked");
  const row = await queryOne<{ id: string }>(
    `UPDATE browser_worker_queue_workers SET revoked_at = now(), revoked_by = $2
     WHERE id = $1 AND revoked_at IS NULL RETURNING id`, [workerId, actor],
  );
  // Read after revocation commits so an enqueue that held the worker lock is visible.
  await query(
    `UPDATE browser_worker_queue_jobs q SET status = 'failed', completed_at = now(),
       result = $2::jsonb, result_hash = $3
     FROM browser_worker_queue_workers w WHERE q.worker_id = w.id AND w.id = $1 AND w.revoked_at IS NOT NULL
       AND q.status IN ('queued','leased')`, [workerId, JSON.stringify(result), sha(JSON.stringify(result))],
  );
  return { revoked: Boolean(row) };
}

export async function listBrowserQueueWorkers() {
  const workers = await query<{ id: string; label: string }>(
    `SELECT id, label FROM browser_worker_queue_workers WHERE revoked_at IS NULL ORDER BY label, id`,
  );
  return { enabled: true, workers };
}

export async function getBrowserQueueJob(applicationId: string) {
  const job = await queryOne<QueueJob>(
    `SELECT * FROM browser_worker_queue_jobs WHERE application_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [queueUuid(applicationId, "application ID")],
  );
  return { job: job ? publicJob(job) : null };
}

export async function enqueueBrowserQueueJob(input: unknown, actor: string, idempotency: string | null) {
  const body = queueObject(input, ["applicationId", "workerId"]);
  const applicationId = queueUuid(body.applicationId, "application ID");
  const requestedWorker = body.workerId === undefined ? null : queueUuid(body.workerId, "worker ID");
  if (!idempotency || !REFERENCE.test(idempotency)) throw new BrowserWorkerQueueError(400, "Valid Idempotency-Key required");
  // Enqueue and attachment selection are one statement. The unique indexes
  // settle retries and concurrent operators without changing applications.
  const inserted = await queryOne<QueueJob>(
    `WITH workers AS MATERIALIZED (
       SELECT id FROM browser_worker_queue_workers WHERE revoked_at IS NULL
         AND ($2::uuid IS NULL OR id = $2) ORDER BY id LIMIT 2
     ), source AS (
       SELECT a.id, a.candidate_id, a.job_id, ${JOB_URL} AS url, ${DIALOG_HEADING} AS heading,
         ${JOB_VERSION} AS job_version, ${RESUME_VERSION} AS resume_revision, x.id AS export_id, v.id AS resume_version,
         x.content_sha256, x.file_size_bytes
       FROM applications a ${SOURCE_JOINS} WHERE a.id = $1 AND ${READY}
     ) INSERT INTO browser_worker_queue_jobs
       (application_id,candidate_id,job_id,worker_id,requested_by,idempotency_key,job_url,expected_dialog_heading,
        job_version,resume_revision,export_id,resume_version_id,content_sha256,byte_length)
       SELECT source.id,candidate_id,job_id,w.id,$3,$4,url,heading,job_version,resume_revision,export_id,resume_version,
         content_sha256,file_size_bytes
       FROM source JOIN browser_worker_queue_workers w ON w.id = (SELECT id FROM workers LIMIT 1)
       WHERE (SELECT count(*) FROM workers) = 1 AND w.revoked_at IS NULL
       FOR UPDATE OF w
       ON CONFLICT DO NOTHING RETURNING *`, [applicationId, requestedWorker, actor, idempotency],
  );
  if (inserted) return { job: publicJob(inserted), duplicate: false };
  const existing = await queryOne<QueueJob>(
    `SELECT * FROM browser_worker_queue_jobs WHERE requested_by = $1 AND idempotency_key = $2`, [actor, idempotency],
  );
  if (existing) {
    if (existing.application_id !== applicationId || (requestedWorker && existing.worker_id !== requestedWorker)) {
      throw new BrowserWorkerQueueError(409, "Idempotency-Key is already bound to a different request");
    }
    return { job: publicJob(existing), duplicate: true };
  }
  const registered = await queryOne<{ count: number }>(
    `SELECT count(*)::integer AS count FROM browser_worker_queue_workers
     WHERE revoked_at IS NULL AND ($1::uuid IS NULL OR id = $1)`, [requestedWorker],
  );
  if (registered?.count !== 1) throw new BrowserWorkerQueueError(409, "Register or select exactly one active browser worker");
  throw new BrowserWorkerQueueError(409, "Application already queued or missing a ready stage, approved review, active candidate, or approved archived PDF");
}

function workerHash(request: Request) {
  const bearer = request.headers.get("authorization") ?? "";
  if (!/^Bearer tbwq_[a-f0-9]{64}$/.test(bearer)) throw new BrowserWorkerQueueError(401, "Valid registered worker credential required");
  return sha(bearer.slice(7));
}

function leaseHash(request: Request) {
  const lease = request.headers.get("x-browser-worker-lease") ?? "";
  if (!/^tblq_[a-f0-9]{64}$/.test(lease)) throw new BrowserWorkerQueueError(409, "Valid worker lease required");
  return sha(lease);
}

function registeredProfiles(input: unknown) {
  const { profiles } = queueObject(input, ["profiles"]);
  if (!Array.isArray(profiles) || profiles.length === 0 || profiles.length > 100) {
    throw new BrowserWorkerQueueError(400, "Supply between 1 and 100 registered candidate profiles");
  }
  const seen = new Set<string>();
  return profiles.map(entry => {
    const body = queueObject(entry, ["candidateId", "profileRef", "profileVersion"]);
    const candidateId = queueUuid(body.candidateId, "candidate ID");
    const { profileRef, profileVersion } = body;
    if (profileRef !== candidateId || typeof profileVersion !== "string" || !REFERENCE.test(profileVersion) || seen.has(candidateId)) {
      throw new BrowserWorkerQueueError(400, "Invalid or duplicate candidate profile");
    }
    seen.add(candidateId);
    return { candidateId, profileVersion };
  });
}

export async function claimBrowserQueueJob(request: Request, input: unknown) {
  const credential = workerHash(request);
  const profiles = registeredProfiles(input);
  const leaseToken = `tblq_${randomBytes(32).toString("hex")}`;
  const stale = expiredResult("application_no_longer_ready");
  const exhausted = expiredResult("worker_lease_exhausted");
  const missingProfile = expiredResult("registered_profile_unavailable");
  // Lock one worker, retry its expired prepare lease once, and expire a stale
  // pinned snapshot or exhausted lease without moving the recruiting stage.
  const result = await queryOne<{ authorized: boolean; job: ClaimWithResumeNaming | null }>(
    `WITH worker AS MATERIALIZED (
       SELECT id FROM browser_worker_queue_workers WHERE credential_hash = $1 AND revoked_at IS NULL FOR UPDATE
     ), profiles AS (
       SELECT * FROM jsonb_to_recordset($2::jsonb) AS p("candidateId" uuid, "profileVersion" text)
     ), eligible AS MATERIALIZED (
       SELECT q.id, p."profileVersion", c.name AS candidate_name, j.title AS job_title
       FROM browser_worker_queue_jobs q JOIN worker w ON w.id = q.worker_id
       JOIN profiles p ON p."candidateId" = q.candidate_id ${BOUND_JOINS}
       WHERE q.status IN ('queued','leased') AND (q.profile_version IS NULL OR q.profile_version = p."profileVersion") AND ${BOUND}
     ), candidate AS (
       SELECT q.id,e."profileVersion",p."profileVersion" AS reported_version FROM browser_worker_queue_jobs q
       JOIN worker w ON w.id = q.worker_id LEFT JOIN profiles p ON p."candidateId" = q.candidate_id
       LEFT JOIN eligible e ON e.id = q.id
       WHERE (q.status = 'leased' AND q.lease_expires_at <= now())
          OR (q.status = 'queued' AND p."profileVersion" IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM browser_worker_queue_jobs leased WHERE leased.worker_id = w.id AND leased.status = 'leased'
          ))
       ORDER BY (q.status = 'leased') DESC,
         (e.id IS NOT NULL) DESC, q.created_at, q.id
       FOR UPDATE OF q SKIP LOCKED LIMIT 1
     ), changed AS (
       UPDATE browser_worker_queue_jobs q SET
         status = CASE WHEN q.attempt >= 2 OR c."profileVersion" IS NULL
            THEN 'failed' ELSE 'leased' END,
         attempt = CASE WHEN q.attempt < 2 AND c."profileVersion" IS NOT NULL
            THEN q.attempt + 1 ELSE q.attempt END,
         profile_version = COALESCE(c."profileVersion", q.profile_version),
         lease_token_hash = CASE WHEN q.attempt < 2 AND c."profileVersion" IS NOT NULL THEN $3 ELSE q.lease_token_hash END,
         lease_expires_at = CASE WHEN q.attempt < 2 AND c."profileVersion" IS NOT NULL THEN now() + interval '5 minutes' ELSE q.lease_expires_at END,
         completed_at = CASE WHEN q.attempt >= 2 OR c."profileVersion" IS NULL THEN now() ELSE NULL END,
         result = CASE WHEN q.attempt >= 2 THEN $6::jsonb
           WHEN c.reported_version IS NULL OR (q.profile_version IS NOT NULL AND q.profile_version <> c.reported_version) THEN $8::jsonb
           WHEN c."profileVersion" IS NULL THEN $4::jsonb ELSE NULL END,
         result_hash = CASE WHEN q.attempt >= 2 THEN $7
           WHEN c.reported_version IS NULL OR (q.profile_version IS NOT NULL AND q.profile_version <> c.reported_version) THEN $9
           WHEN c."profileVersion" IS NULL THEN $5 ELSE NULL END
       FROM candidate c WHERE q.id = c.id RETURNING q.*
     ) SELECT EXISTS(SELECT 1 FROM worker) AS authorized,
       (SELECT to_jsonb(changed) || jsonb_build_object('candidate_name', e.candidate_name, 'job_title', e.job_title)
        FROM changed JOIN eligible e ON e.id = changed.id WHERE changed.status = 'leased') AS job`,
    [credential, JSON.stringify(profiles), sha(leaseToken), JSON.stringify(stale), sha(JSON.stringify(stale)),
      JSON.stringify(exhausted), sha(JSON.stringify(exhausted)), JSON.stringify(missingProfile), sha(JSON.stringify(missingProfile))],
  ).catch((error: unknown) => {
    const failure = error as { code?: string; constraint?: string };
    if (failure.code === "23505" && failure.constraint === "browser_worker_queue_worker_lease") {
      return { authorized: true, job: null };
    }
    throw error;
  });
  if (!result?.authorized) throw new BrowserWorkerQueueError(401, "Worker credential is invalid or revoked");
  const job = result.job;
  if (!job) return null;
  const candidateName = resumeNamingLabel(job.candidate_name);
  const jobTitle = resumeNamingLabel(job.job_title);
  return {
    requestId: job.id, attempt: job.attempt, leaseToken,
    leaseExpiresAt: new Date(job.lease_expires_at).toISOString(), jobUrl: job.job_url,
    expectedDialogHeading: job.expected_dialog_heading,
    ...(candidateName && jobTitle ? { resumeNaming: { candidateName, jobTitle } } : {}),
    manifest: {
      version: 1, mode: "prepare", applicationId: job.application_id, candidateId: job.candidate_id, jobId: job.job_id,
      profileRef: job.candidate_id, profileVersion: job.profile_version, jobVersion: job.job_version,
      effectiveStage: "ready_for_application",
      artifact: { exportId: job.export_id, resumeVersionId: job.resume_version_id, sha256: job.content_sha256,
        byteLength: job.byte_length, contentType: "application/pdf" },
    },
  };
}

async function getQueueLease(requestId: string, credential: string, lease: string) {
  const job = await queryOne<JobClaim>(
    `SELECT q.* FROM browser_worker_queue_jobs q
     JOIN browser_worker_queue_workers w ON w.id = q.worker_id ${BOUND_JOINS}
     WHERE q.id = $1 AND w.credential_hash = $2 AND w.revoked_at IS NULL
       AND q.status = 'leased' AND q.lease_token_hash = $3 AND q.lease_expires_at > now() AND ${BOUND}`,
    [requestId, credential, lease],
  );
  if (!job) throw new BrowserWorkerQueueError(409, "Lease expired or the pinned application is no longer ready");
  return job;
}

async function withQueueLease<T>(request: Request, value: unknown, read: (job: JobClaim) => Promise<T>) {
  const requestId = queueUuid(value, "request ID");
  const worker = workerHash(request);
  const lease = leaseHash(request);
  const job = await getQueueLease(requestId, worker, lease);
  const data = await read(job);
  await getQueueLease(requestId, worker, lease);
  return data;
}

export function getBrowserQueueArtifact(request: Request, value: unknown) {
  return withQueueLease(request, value, async job => {
    const record = await findExportById(job.export_id);
    if (!record || record.id !== job.export_id || record.application_id !== job.application_id ||
        record.resume_version_id !== job.resume_version_id || record.export_type !== "pdf" || record.status !== "created" ||
        record.content_sha256 !== job.content_sha256 || Number(record.file_size_bytes) !== job.byte_length) {
      throw new BrowserWorkerQueueError(409, "Pinned résumé export changed");
    }
    let buffer: Uint8Array;
    if (record.storage_provider === "r2" && record.file_path) {
      ({ buffer } = await downloadResumeFile(record.storage_provider, record.file_path, record.storage_url));
    } else if (record.storage_provider === "sharepoint" || record.storage_provider === TEMPORARY_RESUME_PDF_PROVIDER) {
      buffer = await readApprovedResumePdf(record);
    } else {
      throw new BrowserWorkerQueueError(409, "Pinned résumé storage is unavailable");
    }
    if (buffer.byteLength !== job.byte_length || Buffer.from(buffer.subarray(0, 5)).toString("ascii") !== "%PDF-" ||
        sha(buffer) !== job.content_sha256) throw new BrowserWorkerQueueError(409, "Pinned résumé bytes changed");
    return buffer;
  });
}

export function getBrowserQueueFacts(request: Request, value: unknown) {
  return withQueueLease(request, value, job => getApprovedApplicationAnswers(job.candidate_id, job.job_id));
}

export function validateBrowserQueueResult(input: unknown): QueueResult {
  const body = queueObject(input, ["status", "reason", "missingQuestions"]);
  const { status, reason, missingQuestions } = body;
  if (status !== "prepared" && status !== "needs_human" && status !== "failed") {
    throw new BrowserWorkerQueueError(400, "Only preparation outcomes are accepted");
  }
  if (typeof reason !== "string" || !/^(?!fixture_)[a-z][a-z0-9_]{0,120}$/.test(reason) ||
      (status === "prepared" ? reason !== "final_review_ready" : reason === "final_review_ready")) {
    throw new BrowserWorkerQueueError(400, "Invalid preparation outcome reason");
  }
  const questionBlocker = reason === "missing_required_answers" || reason === "missing_verified_contact";
  if (missingQuestions !== undefined && (!Array.isArray(missingQuestions) || missingQuestions.length > 50 ||
      missingQuestions.some(question => typeof question !== "string" || !question.trim() || question.length > 400))) {
    throw new BrowserWorkerQueueError(400, "Invalid missing question labels");
  }
  const questions: string[] = (missingQuestions as string[] | undefined) ?? [];
  if ((questionBlocker && (status !== "needs_human" || questions.length === 0)) || (!questionBlocker && questions.length)) {
    throw new BrowserWorkerQueueError(400, "Missing questions require a waiting preparation outcome");
  }
  return { status, reason, ...(questions.length ? { missingQuestions: [...new Set(questions.map(question => question.trim()))] } : {}) };
}

export async function recordBrowserQueueResult(request: Request, value: unknown, input: unknown) {
  const requestId = queueUuid(value, "request ID");
  const credential = workerHash(request);
  const lease = leaseHash(request);
  const result = validateBrowserQueueResult(input);
  const encoded = JSON.stringify(result);
  const resultHash = sha(encoded);
  const requireReady = result.status === "prepared" || result.reason === "missing_required_answers" ||
    result.reason === "missing_verified_contact";
  const updated = await queryOne(
    `UPDATE browser_worker_queue_jobs q SET status = $4, result = $5::jsonb, result_hash = $6, completed_at = now()
     FROM browser_worker_queue_workers w WHERE w.id = q.worker_id AND w.credential_hash = $2 AND w.revoked_at IS NULL
     AND q.id = $1 AND q.status = 'leased' AND q.lease_token_hash = $3 AND q.lease_expires_at > now()
     ${requireReady ? `AND EXISTS (SELECT 1 FROM applications a ${SOURCE_JOINS} WHERE a.id = q.application_id AND ${BOUND})` : ""}
     RETURNING q.id`, [requestId, credential, lease, result.status, encoded, resultHash],
  );
  if (updated) return { requestId, status: result.status, duplicate: false };
  const replay = await queryOne(
    `SELECT q.id FROM browser_worker_queue_jobs q JOIN browser_worker_queue_workers w ON w.id = q.worker_id
     WHERE q.id = $1 AND w.credential_hash = $2 AND w.revoked_at IS NULL
       AND q.lease_token_hash = $3 AND q.result_hash = $4 AND q.status NOT IN ('queued','leased')`,
    [requestId, credential, lease, resultHash],
  );
  if (replay) return { requestId, status: result.status, duplicate: true };
  throw new BrowserWorkerQueueError(409, "Result conflicts with an expired, stale, or completed lease");
}
