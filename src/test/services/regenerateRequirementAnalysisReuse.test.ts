// Phase 5 of the AI Resume Pipeline Waste Removal & Quality Hardening plan
// (2026-09-29): Regenerate re-ran the whole pipeline from scratch every time,
// including the per-candidate requirement-classification AI call, even when a
// user clicked Regenerate without anything about (job, candidate, base
// resume) having changed. Regenerate targets the SAME application, so job and
// candidate are pinned by applicationId itself - only the base resume can
// differ, and that is compared by content hash against what the previous run
// actually analyzed (config_snapshot.baseResume is an immutable snapshot).
//
// These tests pin both directions: reuse when the content is identical, and a
// real re-run the moment it differs.

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

// See the identical note in workflowStageProcessing.test.ts - "server-only"
// is unresolvable outside a real Next.js server build.
vi.mock("@/server/lib/waitUntil", () => ({
  backgroundDispatch: vi.fn().mockImplementation(async (p: Promise<unknown>) => { await p.catch(() => {}); }),
}));

import { query, queryOne, execute } from "@/server/db/neon";
import { createWorkflow } from "@/server/repositories/applicationAiWorkflowRepository";
import { regenerateAiWorkflowForApplication } from "@/server/services/applicationAiWorkflowService";

const CANDIDATE_ID = "cand-1";
const JOB_ID = "job-1";
const APPLICATION_ID = "app-1";

const CURRENT_RESUME_CONTENT = {
  personalInfo: { fullName: "Real Candidate" },
  skills: ["AutoCAD", "ArcGIS"],
  experience: [{ title: "GIS Analyst", company: "Acme", bullets: ["Mapped things"] }],
};

const PRIOR_REQUIREMENT_ANALYSIS = [
  { requirement: "AutoCAD", category: "tool", sourceEvidence: ["base.skills[0]"], status: "supported_by_resume", safeToAdd: true },
  { requirement: "ArcGIS", category: "tool", sourceEvidence: ["base.skills[1]"], status: "supported_by_resume", safeToAdd: true },
];

/**
 * @param priorBaseContent what the previous run's immutable config_snapshot
 * recorded as the base resume it analyzed - identical content means the prior
 * requirementAnalysis is still valid, different content means it is not.
 * `null` simulates an application with no prior run at all.
 */
function baseDbMock(priorBaseContent: unknown | null) {
  (query as any).mockImplementation(async (sql: string) => {
    if (sql.includes("FROM candidate_evidence")) return [];
    return [];
  });
  (queryOne as any).mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes("SELECT candidate_id, job_id FROM applications")) {
      return { candidate_id: CANDIDATE_ID, job_id: JOB_ID };
    }
    if (sql.includes("SELECT * FROM jobs WHERE id")) {
      return { id: JOB_ID, title: "GIS Analyst", company: "Acme" };
    }
    if (sql.includes("SELECT last_error FROM application_ai_workflows")) {
      return null; // never retry-blocked
    }
    // The Phase 5 prior-run lookup under test.
    if (sql.includes("application_ai_artifacts aa") && sql.includes("application_job_lens")) {
      if (priorBaseContent === null) return null;
      return {
        config_snapshot: { baseResume: { content: priorBaseContent } },
        job_lens_data: { requirementAnalysis: PRIOR_REQUIREMENT_ANALYSIS },
      };
    }
    if (sql.includes("FROM application_resume_versions arv") && sql.includes("target_job_id IN")) {
      return null; // no target-job-linked resume - falls through to domain match
    }
    if (sql.includes("SELECT id, content FROM base_resumes WHERE candidate_id")) {
      return { id: "resume-1", content: CURRENT_RESUME_CONTENT };
    }
    if (sql.includes("INSERT INTO application_resume_versions")) {
      return { id: "arv-1", candidate_id: CANDIDATE_ID, base_resume_id: "resume-1", content: CURRENT_RESUME_CONTENT };
    }
    if (sql.includes("SELECT verified_skills FROM candidates")) {
      return { verified_skills: [] };
    }
    if (sql.includes("FROM ai_runtime_config")) {
      return null; // getAiRuntimeConfig() defaults - no active routing state
    }
    return null;
  });
  (execute as any).mockResolvedValue({ rowCount: 1 });
  global.fetch = vi.fn().mockResolvedValue({ status: 200, text: async () => "" }) as any;
}

function snapshotFromLastCreateWorkflow() {
  expect(createWorkflow).toHaveBeenCalledTimes(1);
  return (createWorkflow as any).mock.calls[0][0].configSnapshot;
}

describe("regenerateAiWorkflowForApplication — requirementAnalysis reuse (Phase 5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reuses the prior run's requirementAnalysis when the base resume content is unchanged", async () => {
    baseDbMock(CURRENT_RESUME_CONTENT);

    const result = await regenerateAiWorkflowForApplication(APPLICATION_ID, "user-1");

    expect(result.started).toBe(true);
    expect(snapshotFromLastCreateWorkflow().cachedRequirementAnalysis).toEqual(PRIOR_REQUIREMENT_ANALYSIS);
  });

  it("does NOT reuse when the base resume content changed since the prior run", async () => {
    baseDbMock({ ...CURRENT_RESUME_CONTENT, skills: ["AutoCAD", "ArcGIS", "Civil 3D"] });

    const result = await regenerateAiWorkflowForApplication(APPLICATION_ID, "user-1");

    expect(result.started).toBe(true);
    expect(snapshotFromLastCreateWorkflow().cachedRequirementAnalysis).toBeNull();
  });

  it("does NOT reuse when the application has no prior run to reuse from", async () => {
    baseDbMock(null);

    const result = await regenerateAiWorkflowForApplication(APPLICATION_ID, "user-1");

    expect(result.started).toBe(true);
    expect(snapshotFromLastCreateWorkflow().cachedRequirementAnalysis).toBeNull();
  });
});
