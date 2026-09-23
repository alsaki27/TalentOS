// Regression coverage for deleteApplication's cleanup of candidate+job state
// that outlives the applications row itself.
//
// Bug: deleting an application only ever removed job_match_scores and the
// applications row. application_resume_versions.application_id is ON DELETE
// SET NULL (and materializeFromBaseResume never sets it in the first place),
// so a resume materialized/tailored for that candidate+job pair survived as
// an orphan, still linked via target_jobs(candidate_id, job_id) and still
// status='active'. The next time that candidate was logged against the same
// job, triggerAiWorkflowForApplication's target_job-linked lookup found the
// orphan and silently reused it - ignoring whatever base resume was chosen
// for the new attempt. Fix: once no other application references that exact
// (candidate_id, job_id) pair, delete target_jobs too - it cascades away
// every application_resume_versions row tied to it (this attempt's and any
// earlier orphaned ones), so the next attempt starts genuinely clean.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db/neon", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

import { queryOne, execute } from "@/server/db/neon";
import { deleteApplication } from "@/server/repositories/applicationsRepository";

const APPLICATION_ID = "app-1";
const CANDIDATE_ID = "cand-1";
const JOB_ID = "job-1";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deleteApplication", () => {
  it("deletes target_jobs (and everything that cascades from it) once no other application references this candidate+job pair", async () => {
    (queryOne as any).mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT job_id, candidate_id FROM applications WHERE id")) {
        return { job_id: JOB_ID, candidate_id: CANDIDATE_ID };
      }
      if (sql.includes("SELECT EXISTS(SELECT 1 FROM applications")) {
        return { exists: false }; // this was the only application for this candidate+job pair
      }
      return null;
    });

    await deleteApplication(APPLICATION_ID);

    const executeCalls = (execute as any).mock.calls.map((c: any[]) => c[0] as string);
    expect(executeCalls.some((sql: string) => sql.includes("DELETE FROM applications WHERE id"))).toBe(true);
    expect(executeCalls.some((sql: string) => sql.includes("DELETE FROM target_jobs"))).toBe(true);
  });

  it("leaves target_jobs alone when another application still references this exact candidate+job pair", async () => {
    (queryOne as any).mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT job_id, candidate_id FROM applications WHERE id")) {
        return { job_id: JOB_ID, candidate_id: CANDIDATE_ID };
      }
      if (sql.includes("SELECT EXISTS(SELECT 1 FROM applications")) {
        return { exists: true }; // a second application for the same pair still exists
      }
      return null;
    });

    await deleteApplication(APPLICATION_ID);

    const executeCalls = (execute as any).mock.calls.map((c: any[]) => c[0] as string);
    expect(executeCalls.some((sql: string) => sql.includes("DELETE FROM applications WHERE id"))).toBe(true);
    expect(executeCalls.some((sql: string) => sql.includes("DELETE FROM target_jobs"))).toBe(false);
  });

  it("is a no-op when the application no longer exists", async () => {
    (queryOne as any).mockResolvedValue(null);

    await deleteApplication(APPLICATION_ID);

    expect(execute).not.toHaveBeenCalled();
  });
});
