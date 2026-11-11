import {
  APPLICATION_FACT_PROFILE_FIELDS,
  normalizeApplicationQuestion,
  profileMatchesApplicationFact,
  resolveApplicationFacts,
  type ApplicationFactDraft,
  type ApplicationFactProfile,
  type ApprovedApplicationAnswers,
  type CandidateApplicationFact,
} from "@/lib/candidateApplicationFacts";
import { query, queryOne } from "@/server/db/neon";

const maxFacts = 500;
const columns = `id, candidate_id AS "candidateId", job_id AS "jobId", revision, section, question,
  value_kind AS "valueKind", disposition, answer_value AS value, source_kind AS "sourceKind",
  source_ref AS "sourceRef", expires_at AS "expiresAt", review_state AS "reviewState",
  reviewed_by_user_id AS "reviewedBy", reviewed_at AS "reviewedAt"`;

type FactRow = Omit<CandidateApplicationFact, "expiresAt" | "reviewedAt"> & {
  expiresAt: string | Date | null;
  reviewedAt: string | Date | null;
};

interface MissingQuestionRun {
  jobId: string;
  jobTitle: string | null;
  detectedAt: string | Date;
  questions: unknown;
}

interface MissingApplicationQuestion {
  jobId: string;
  jobTitle?: string;
  detectedAt: string;
  question: string;
}

const writeColumns = `candidate_id, job_id, section, question, question_key, value_kind, disposition,
  answer_value, source_kind, source_ref, expires_at, created_by_user_id`;
const writeValues = "$1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11::timestamptz,$12::uuid";
const permittedJob = `($2::uuid IS NULL OR EXISTS (
  SELECT 1 FROM applications WHERE candidate_id = $1 AND job_id = $2
))`;

function asFact(row: FactRow): CandidateApplicationFact {
  return {
    ...row,
    expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
    reviewedAt: row.reviewedAt ? new Date(row.reviewedAt).toISOString() : null,
  };
}

function draftValues(candidateId: string, draft: ApplicationFactDraft, userId: string) {
  return [
    candidateId, draft.jobId, draft.section, draft.question, normalizeApplicationQuestion(draft.question),
    draft.valueKind, draft.disposition, draft.value === null ? null : JSON.stringify(draft.value),
    draft.sourceKind, draft.sourceRef, draft.expiresAt, userId,
  ];
}

export async function loadApplicationFactProfile(candidateId: string): Promise<ApplicationFactProfile | null> {
  return queryOne<ApplicationFactProfile>(
    `SELECT ${Object.keys(APPLICATION_FACT_PROFILE_FIELDS).join(", ")} FROM candidates WHERE id = $1`,
    [candidateId],
  );
}

export async function listCandidateApplicationFacts(
  candidateId: string,
  jobId?: string,
): Promise<CandidateApplicationFact[]> {
  const facts = await query<FactRow>(
    `SELECT * FROM (
      SELECT DISTINCT ON (id) ${columns}
      FROM candidate_application_facts WHERE candidate_id = $1
      ORDER BY id, revision DESC
    ) current_facts
    ${jobId ? 'WHERE "jobId" IS NULL OR "jobId" = $2::uuid' : ""}
    ORDER BY section, question, id LIMIT ${maxFacts + 1}`,
    jobId ? [candidateId, jobId] : [candidateId],
  );
  if (facts.length > maxFacts) throw new Error("Application answer bank exceeds its fact limit.");
  return facts.map(asFact);
}

export async function getApprovedApplicationAnswers(
  candidateId: string,
  jobId: string,
  questions?: readonly string[],
): Promise<ApprovedApplicationAnswers> {
  const [profile, facts] = await Promise.all([
    loadApplicationFactProfile(candidateId),
    listCandidateApplicationFacts(candidateId, jobId),
  ]);
  if (!profile) throw new Error("Candidate no longer exists.");
  return resolveApplicationFacts(facts, candidateId, jobId, profile, questions);
}

export async function listMissingApplicationQuestions(
  candidateId: string, profile: ApplicationFactProfile, facts: CandidateApplicationFact[],
): Promise<MissingApplicationQuestion[]> {
  // Read the latest real screening observation for each application. The
  // enrollment survives revocation so re-enrolling does not lose a blocker.
  let runs: MissingQuestionRun[];
  try {
    runs = await query<MissingQuestionRun>(
      `WITH latest AS (
        SELECT DISTINCT ON (e.application_id) r.id, r.status, r.completed_at,
          e.job_id, j.title, r.result->'missingQuestions' AS questions
        FROM browser_worker_prepare_enrollments e
        JOIN browser_worker_prepare_runs r ON r.enrollment_id = e.id
        JOIN applications a ON a.id = e.application_id AND a.candidate_id = e.candidate_id AND a.job_id = e.job_id
        JOIN jobs j ON j.id = e.job_id
        WHERE e.candidate_id = $1 AND a.applied_at IS NULL AND j.is_active
          AND COALESCE(NULLIF(j.apply_url, ''), j.source_url) = e.job_url
          AND r.completed_at IS NOT NULL AND (
            (r.status = 'needs_human' AND r.result->>'reason' = 'missing_required_answers') OR
            (r.status = 'prepared' AND r.result->>'reason' = 'final_review_ready')
          )
        ORDER BY e.application_id, r.completed_at DESC, r.id DESC
      )
      SELECT job_id AS "jobId", title AS "jobTitle", completed_at AS "detectedAt", questions
      FROM latest WHERE status = 'needs_human'
      ORDER BY completed_at DESC, id DESC`,
      [candidateId],
    );
  } catch (cause) {
    // The answer bank can be deployed without the optional worker tables.
    if ((cause as { code?: string } | null)?.code === "42P01") return [];
    throw cause;
  }

  const byJob = new Map<string, Map<string, MissingApplicationQuestion>>();
  for (const run of runs) {
    if (!Array.isArray(run.questions)) continue;
    const questions = byJob.get(run.jobId) ?? new Map<string, MissingApplicationQuestion>();
    byJob.set(run.jobId, questions);
    for (const raw of run.questions) {
      if (typeof raw !== "string") continue;
      const question = raw.trim().replace(/\s+/g, " ");
      if (!question || question.length > 400) continue;
      const key = normalizeApplicationQuestion(question);
      if (!questions.has(key)) {
        questions.set(key, {
          jobId: run.jobId,
          ...(run.jobTitle ? { jobTitle: run.jobTitle } : {}),
          detectedAt: new Date(run.detectedAt).toISOString(),
          question,
        });
      }
    }
  }

  return [...byJob.entries()].flatMap(([jobId, questions]) => {
    const entries = [...questions.values()];
    const { blocked } = resolveApplicationFacts(facts, candidateId, jobId, profile, entries.map(entry => entry.question));
    const unresolved = new Set(blocked.map(block => block.question));
    return entries.filter(entry => unresolved.has(entry.question));
  });
}

export async function createApplicationFactDraft(
  candidateId: string, draft: ApplicationFactDraft, userId: string,
): Promise<CandidateApplicationFact | null> {
  const row = await queryOne<FactRow>(
    `INSERT INTO candidate_application_facts (${writeColumns})
     SELECT ${writeValues} FROM candidates WHERE id = $1 AND ${permittedJob}
       AND (SELECT COUNT(DISTINCT id) FROM candidate_application_facts WHERE candidate_id = $1) < ${maxFacts}
     RETURNING ${columns}`,
    draftValues(candidateId, draft, userId),
  );
  return row && asFact(row);
}

export async function reviseApplicationFact(
  candidateId: string, factId: string, expectedRevision: number, draft: ApplicationFactDraft, userId: string,
): Promise<CandidateApplicationFact | null> {
  const row = await queryOne<FactRow>(
    `INSERT INTO candidate_application_facts (id, revision, ${writeColumns})
     SELECT current_fact.id, current_fact.revision + 1, ${writeValues}
     FROM candidate_application_facts current_fact
     WHERE current_fact.candidate_id = $1 AND current_fact.id = $13 AND current_fact.revision = $14
       AND current_fact.question = $4 AND current_fact.job_id IS NOT DISTINCT FROM $2::uuid
       AND ${permittedJob}
       AND NOT EXISTS (
         SELECT 1 FROM candidate_application_facts newer
         WHERE newer.id = current_fact.id AND newer.revision > current_fact.revision
       )
     ON CONFLICT (id, revision) DO NOTHING
     RETURNING ${columns}`,
    [...draftValues(candidateId, draft, userId), factId, expectedRevision],
  );
  return row && asFact(row);
}

export async function reviewApplicationFact(
  candidateId: string, factId: string, expectedRevision: number, action: "approve" | "revoke", userId: string,
): Promise<CandidateApplicationFact | null> {
  if (action === "approve") {
    const [profile, current] = await Promise.all([
      loadApplicationFactProfile(candidateId),
      queryOne<FactRow>(
        `SELECT ${columns} FROM candidate_application_facts
         WHERE candidate_id = $1 AND id = $2 AND revision = $3`,
        [candidateId, factId, expectedRevision],
      ),
    ]);
    if (!profile || !current || !profileMatchesApplicationFact(current, profile)) return null;
  }
  const row = await queryOne<FactRow>(
    `UPDATE candidate_application_facts f SET
      ${action === "approve"
        ? "review_state = 'approved', reviewed_by_user_id = $4, reviewed_at = now()"
        : "review_state = 'revoked', revoked_by_user_id = $4, revoked_at = now()"}
     WHERE f.candidate_id = $1 AND f.id = $2 AND f.revision = $3
       AND ${action === "approve"
         ? `f.review_state = 'draft' AND (f.expires_at IS NULL OR f.expires_at > now())
            AND (f.job_id IS NULL OR EXISTS (
              SELECT 1 FROM applications a WHERE a.candidate_id = f.candidate_id AND a.job_id = f.job_id
            ))
            AND NOT EXISTS (
              SELECT 1 FROM candidate_application_facts duplicate
              WHERE duplicate.candidate_id = f.candidate_id AND duplicate.id <> f.id
                AND duplicate.job_id IS NOT DISTINCT FROM f.job_id
                AND duplicate.question_key = f.question_key AND duplicate.review_state <> 'revoked'
                AND NOT EXISTS (
                  SELECT 1 FROM candidate_application_facts replacement
                  WHERE replacement.id = duplicate.id AND replacement.revision > duplicate.revision
                )
            )`
         : "f.review_state <> 'revoked'"}
       AND NOT EXISTS (
         SELECT 1 FROM candidate_application_facts newer WHERE newer.id = f.id AND newer.revision > f.revision
       )
     RETURNING ${columns}`,
    [candidateId, factId, expectedRevision, userId],
  );
  return row && asFact(row);
}
