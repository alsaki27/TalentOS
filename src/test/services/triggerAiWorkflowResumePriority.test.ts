// Regression coverage for triggerAiWorkflowForApplication's base-resume
// resolution order.
//
// Bug: the target_job-linked resume lookup ran unconditionally, before ever
// checking preferredBaseResumeId. A resume materialized against a
// candidate+job pair from an earlier attempt (including one whose
// application was since deleted - application_resume_versions outlives the
// application it was created for) stayed linked via target_jobs and won
// every time, even when the caller explicitly chose a different resume for
// a fresh attempt. Confirmed live: pick resume A, generate, delete the
// ticket, log the same job again picking resume B - the tailored output
// still came from A.
//
// Fix: an explicit preferredBaseResumeId is now checked first and always
// wins. These tests prove that ordering directly, and confirm the no-choice
// fallback path (target_job link -> domain match -> most recent) is
// unchanged.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db/neon", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@/server/repositories/applicationAiWorkflowRepository", () => ({
  findActiveWorkflowByApplicationId: vi.fn().mockResolvedValue(null),
  createWorkflow: vi.fn().mockResolvedValue({ id: "wf-new" }),
}));

vi.mock("@/server/repositories/targetJobsRepository", () => ({
  upsertTargetJobByCandidateAndJob: vi.fn().mockResolvedValue({ id: "target-job-1" }),
}));

vi.mock("@/server/services/sourceOfTruthService", () => ({
  getSourceOfTruth: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/ai/selectBestBaseResume", () => ({
  selectBestBaseResume: vi.fn().mockResolvedValue(null),
}));

// @opennextjs/cloudflare pulls in "server-only", unresolvable outside a real
// Next.js server build - mock it out rather than let the static import of
// backgroundDispatch drag it in at module-load time (see the identical note
// in workflowStageProcessing.test.ts).
vi.mock("@/server/lib/waitUntil", () => ({
  backgroundDispatch: vi.fn().mockImplementation(async (p: Promise<unknown>) => { await p.catch(() => {}); }),
}));

import { query, queryOne, execute } from "@/server/db/neon";
import { createWorkflow } from "@/server/repositories/applicationAiWorkflowRepository";
import { upsertTargetJobByCandidateAndJob } from "@/server/repositories/targetJobsRepository";
import { selectBestBaseResume } from "@/lib/ai/selectBestBaseResume";
import { triggerAiWorkflowForApplication } from "@/server/services/applicationAiWorkflowService";

const CANDIDATE_ID = "cand-1";
const JOB_ID = "job-1";
const APPLICATION_ID = "app-1";

// The stale resume a PRIOR (possibly since-deleted) attempt left linked to
// this candidate+job pair via target_jobs - what the bug incorrectly reused.
const STALE_TARGET_JOB_LINKED_RESUME = {
  id: "arv-stale",
  base_resume_id: "resume-A-wrong",
  content: { personalInfo: { fullName: "Stale" } },
};

function baseDbMock() {
  (query as any).mockImplementation(async (sql: string, _params?: unknown[]) => {
    if (sql.includes("FROM candidate_evidence")) return [];
    return [];
  });
  (queryOne as any).mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes("SELECT candidate_id, job_id FROM applications")) {
      return { candidate_id: CANDIDATE_ID, job_id: JOB_ID };
    }
    if (sql.includes("SELECT * FROM jobs WHERE id")) {
      return { id: JOB_ID, title: "Test Job", company: "Test Co" };
    }
    if (sql.includes("SELECT last_error FROM application_ai_workflows")) {
      return null; // no prior attempt - never retry-blocked
    }
    if (sql.includes("FROM application_resume_versions arv") && sql.includes("target_job_id IN")) {
      // The old, buggy unconditional lookup. Only the no-preference test
      // should ever depend on this returning something.
      return STALE_TARGET_JOB_LINKED_RESUME;
    }
    if (sql.includes("SELECT id, content FROM base_resumes WHERE id = $1 AND candidate_id = $2")) {
      const [preferredId] = params ?? [];
      return { id: preferredId, content: { personalInfo: { fullName: "Chosen" } } };
    }
    if (sql.includes("SELECT id, content FROM base_resumes WHERE candidate_id")) {
      return { id: "resume-most-recent", content: { personalInfo: { fullName: "Most Recent" } } };
    }
    if (sql.includes("INSERT INTO application_resume_versions")) {
      const [candidateId, baseResumeId] = params ?? [];
      return { id: `arv-for-${baseResumeId}`, candidate_id: candidateId, base_resume_id: baseResumeId };
    }
    if (sql.includes("SELECT verified_skills FROM candidates")) {
      return { verified_skills: [] };
    }
    if (sql.includes("FROM ai_runtime_config")) {
      return null; // -> getAiRuntimeConfig() defaults: no active routing state
    }
    return null;
  });
  (execute as any).mockResolvedValue({ rowCount: 1 });
  global.fetch = vi.fn().mockResolvedValue({ status: 200, text: async () => "" }) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  baseDbMock();
});

describe("triggerAiWorkflowForApplication - base resume priority", () => {
  it("honours an explicit preferredBaseResumeId even when a different resume is already linked to this candidate+job pair", async () => {
    const result = await triggerAiWorkflowForApplication(APPLICATION_ID, "user-1", "resume-B-chosen");

    expect(result.started).toBe(true);
    expect(createWorkflow).toHaveBeenCalledTimes(1);
    const call = (createWorkflow as any).mock.calls[0][0];
    expect(call.baseResumeId).toBe("resume-B-chosen");
    expect(call.configSnapshot.baseResume.base_resume_id).toBe("resume-B-chosen");
    expect(call.matchReason).toBe("User-selected base resume");

    // The stale target_job-linked resume must never win, and domain-matched
    // selection must never even run when an explicit choice was given.
    expect(call.configSnapshot.baseResume.base_resume_id).not.toBe("resume-A-wrong");
    expect(selectBestBaseResume).not.toHaveBeenCalled();
  });

  it("still falls back to the target_job-linked resume when no preferredBaseResumeId is given", async () => {
    const result = await triggerAiWorkflowForApplication(APPLICATION_ID, "user-1");

    expect(result.started).toBe(true);
    expect(createWorkflow).toHaveBeenCalledTimes(1);
    const call = (createWorkflow as any).mock.calls[0][0];
    expect(call.configSnapshot.baseResume.base_resume_id).toBe("resume-A-wrong");
    expect(call.matchReason).toBeUndefined();
  });

  it("guarantees the target_job link exists for this candidate+job pair before starting", async () => {
    await triggerAiWorkflowForApplication(APPLICATION_ID, "user-1", "resume-B-chosen");
    expect(upsertTargetJobByCandidateAndJob).toHaveBeenCalledWith(
      CANDIDATE_ID,
      JOB_ID,
      expect.objectContaining({ raw_description: expect.any(String) })
    );
  });
});
