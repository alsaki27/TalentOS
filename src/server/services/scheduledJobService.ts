import { execute } from "@/server/db/neon";

export async function recordJobAttempt(jobName: string): Promise<string> {
  const runId = `${jobName}_${Date.now()}`;
  await execute(
    `INSERT INTO scheduled_job_runs (job_name, last_attempt_at)
     VALUES ($1, NOW())
     ON CONFLICT (job_name)
     DO UPDATE SET last_attempt_at = NOW()`,
    [jobName]
  );
  return runId;
}

export async function recordJobSuccess(
  jobName: string,
  durationMs: number,
  summary?: string
): Promise<void> {
  await execute(
    `INSERT INTO scheduled_job_runs (job_name, last_success_at, last_duration_ms, last_result_summary)
     VALUES ($1, NOW(), $2, $3)
     ON CONFLICT (job_name)
     DO UPDATE SET
       last_success_at = NOW(),
       last_duration_ms = $2,
       last_result_summary = $3,
       last_error = NULL`,
    [jobName, durationMs, summary ?? null]
  );
}

export async function recordJobFailure(
  jobName: string,
  error: string,
  durationMs: number
): Promise<void> {
  await execute(
    `INSERT INTO scheduled_job_runs (job_name, last_failure_at, last_error, last_duration_ms)
     VALUES ($1, NOW(), $2, $3)
     ON CONFLICT (job_name)
     DO UPDATE SET
       last_failure_at = NOW(),
       last_error = $2,
       last_duration_ms = $3`,
    [jobName, error, durationMs]
  );
}
