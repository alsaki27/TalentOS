import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(), queryOne: vi.fn(), execute: vi.fn(),
  createApplications: vi.fn(), triggerAiWorkflowForApplication: vi.fn(),
  callWithUsageTracking: vi.fn(),
}));

vi.mock("@/server/db/neon", () => ({ query: mocks.query, queryOne: mocks.queryOne, execute: mocks.execute }));
vi.mock("@/server/repositories/applicationsRepository", () => ({ createApplications: mocks.createApplications }));
vi.mock("@/server/services/applicationAiWorkflowService", () => ({ triggerAiWorkflowForApplication: mocks.triggerAiWorkflowForApplication }));
vi.mock("@/lib/ai/routing", () => ({
  callWithUsageTracking: mocks.callWithUsageTracking,
  AiRouteCallError: class AiRouteCallError extends Error {
    provider?: string; model?: string;
    constructor(message: string, provider?: string, model?: string) { super(message); this.provider = provider; this.model = model; }
  },
}));

import { approveReviewItem, rejectReviewItem, bulkApproveByTier, retryAiScoring } from "@/server/services/candidateJobReviewQueueService";
import {parseCandidateReviewFilters} from "@/lib/candidateReviewFilters";

const queueId = "11111111-1111-4111-8111-111111111111";
const candidateId = "22222222-2222-4222-8222-222222222222";
const jobId = "33333333-3333-4333-8333-333333333333";
const resumeId = "44444444-4444-4444-8444-444444444444";
const actorId = "55555555-5555-4555-8555-555555555555";
const applicationId = "66666666-6666-4666-8666-666666666666";

function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: queueId, source: "scheduled_logging", candidate_id: candidateId, job_id: jobId,
    base_resume_id: resumeId, alternate_resumes: [], ats_score: 85,
    ai_status: "scored", ai_tier: "strong", ai_score: 90, ai_reason: "Good fit.", ai_failure_reason: null,
    hard_gates: [], status: "pending", priority: "default",
    assigned_by_user_id: actorId, assigned_to_user_id: actorId,
    assignment_note: null, assignment_due_at: null,
    reviewed_by_user_id: null, reviewed_at: null, review_note: null, application_id: null,
    ...overrides,
  };
}

describe("candidateJobReviewQueueService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue({ rowCount: 1 });
    mocks.createApplications.mockResolvedValue([{ id: applicationId, candidate_id: candidateId, job_id: jobId }]);
    mocks.triggerAiWorkflowForApplication.mockResolvedValue({ started: true });
  });

  describe("approveReviewItem", () => {
    it("re-validates eligibility, creates the application, and triggers the AI workflow", async () => {
      mocks.queryOne.mockImplementation(async (sql: string) => {
        if (sql.includes("FROM candidate_job_review_queue WHERE id")) return pendingRow();
        if (sql.includes("FROM jobs WHERE id")) return { is_active: true };
        if (sql.includes("FROM candidates WHERE id")) return { status: "active", pipeline_stage: "applying" };
        if (sql.includes("FROM applications WHERE job_id")) return null;
        return null;
      });

      const result = await approveReviewItem(queueId, actorId);

      expect(result).toEqual({ applicationId });
      expect(mocks.createApplications).toHaveBeenCalledWith([expect.objectContaining({
        candidate_id: candidateId, job_id: jobId, status: "assigned", base_resume_id: resumeId,
      })]);
      expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining("ae_stage = 'in_ai_pipeline'"), expect.arrayContaining([applicationId, actorId]));
      expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining("UPDATE candidate_job_review_queue"), [queueId, applicationId, actorId]);
      expect(mocks.triggerAiWorkflowForApplication).toHaveBeenCalledWith(applicationId, actorId, resumeId);
    });

    it("refuses to approve an already-rejected item", async () => {
      mocks.queryOne.mockResolvedValue(pendingRow({ status: "rejected" }));
      await expect(approveReviewItem(queueId, actorId)).rejects.toThrow(/already rejected/);
      expect(mocks.createApplications).not.toHaveBeenCalled();
    });

    it("is idempotent: re-approving an already-approved item just re-triggers the AI workflow", async () => {
      mocks.queryOne.mockResolvedValue(pendingRow({ status: "approved", application_id: applicationId }));
      const result = await approveReviewItem(queueId, actorId);
      expect(result).toEqual({ applicationId });
      expect(mocks.createApplications).not.toHaveBeenCalled();
      expect(mocks.triggerAiWorkflowForApplication).toHaveBeenCalledWith(applicationId, actorId, resumeId);
    });

    it("refuses to approve when no base resume is attached", async () => {
      mocks.queryOne.mockResolvedValue(pendingRow({ base_resume_id: null }));
      await expect(approveReviewItem(queueId, actorId)).rejects.toThrow(/No base resume/);
    });

    it("refuses to approve when the job is no longer active", async () => {
      mocks.queryOne.mockImplementation(async (sql: string) => {
        if (sql.includes("FROM candidate_job_review_queue WHERE id")) return pendingRow();
        if (sql.includes("FROM jobs WHERE id")) return { is_active: false };
        if (sql.includes("FROM candidates WHERE id")) return { status: "active", pipeline_stage: "applying" };
        if (sql.includes("FROM applications WHERE job_id")) return null;
        return null;
      });
      await expect(approveReviewItem(queueId, actorId)).rejects.toThrow(/no longer active/);
      expect(mocks.createApplications).not.toHaveBeenCalled();
    });

    it("refuses to approve when another candidate was already applied to this job since it was queued (global dedup)", async () => {
      mocks.queryOne.mockImplementation(async (sql: string) => {
        if (sql.includes("FROM candidate_job_review_queue WHERE id")) return pendingRow();
        if (sql.includes("FROM jobs WHERE id")) return { is_active: true };
        if (sql.includes("FROM candidates WHERE id")) return { status: "active", pipeline_stage: "applying" };
        if (sql.includes("FROM applications WHERE job_id")) return { id: "someone-elses-app" };
        return null;
      });
      await expect(approveReviewItem(queueId, actorId)).rejects.toThrow(/Another candidate has already been applied/);
      expect(mocks.createApplications).not.toHaveBeenCalled();
    });
  });

  describe("rejectReviewItem", () => {
    it("marks a pending item rejected with the reviewer's note", async () => {
      mocks.queryOne.mockResolvedValue(pendingRow());
      await rejectReviewItem(queueId, actorId, "Not a fit.");
      expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining("status = 'rejected'"), [queueId, actorId, "Not a fit."]);
    });

    it("refuses to reject an item that was already approved and has a live application", async () => {
      mocks.queryOne.mockResolvedValue(pendingRow({ status: "approved", application_id: applicationId }));
      await expect(rejectReviewItem(queueId, actorId, null)).rejects.toThrow(/already approved/);
    });
  });

  describe("bulkApproveByTier", () => {
    it("limits bulk selection to the current candidate, staff owner and queued-time range",async()=>{
      mocks.query.mockResolvedValue([]);
      const filters=parseCandidateReviewFilters(new URLSearchParams({candidate_id:candidateId,staff_id:actorId,start:"2026-11-04T00:00:00Z",end:"2026-11-04T03:00:00Z"}));
      await bulkApproveByTier(["strong"],actorId,filters);
      const [sql,values]=mocks.query.mock.calls[0];
      expect(sql).toContain("q.candidate_id = $2::uuid");expect(sql).toContain("q.assigned_to_user_id = $3::uuid");
      expect(sql).toContain("q.created_at >= $4::timestamptz");expect(sql).toContain("q.created_at <= $5::timestamptz");
      expect(values).toEqual([["strong"],candidateId,actorId,"2026-11-04T00:00:00.000Z","2026-11-04T03:00:00.000Z"]);
      expect(mocks.createApplications).not.toHaveBeenCalled();
    });
    it("approves every pending item matching the given tiers and reports failures separately", async () => {
      mocks.query.mockResolvedValue([{ id: "q-1" }, { id: "q-2" }]);
      let call = 0;
      mocks.queryOne.mockImplementation(async (sql: string) => {
        if (sql.includes("FROM candidate_job_review_queue WHERE id")) {
          call++;
          return call === 1 ? pendingRow({ id: "q-1" }) : null; // second item: row not found -> throws
        }
        if (sql.includes("FROM jobs WHERE id")) return { is_active: true };
        if (sql.includes("FROM candidates WHERE id")) return { status: "active", pipeline_stage: "applying" };
        if (sql.includes("FROM applications WHERE job_id")) return null;
        return null;
      });

      const result = await bulkApproveByTier(["strong", "adjacent"], actorId);
      expect(result.approved).toBe(1);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].id).toBe("q-2");
    });
  });

  describe("retryAiScoring", () => {
    it.each(["adjacent", "reject"] as const)("re-scores Stage 2 as %s and keeps the item for human review", async tier => {
      mocks.queryOne.mockImplementation(async (sql: string) => {
        if (sql.includes("FROM candidate_job_review_queue WHERE id")) return pendingRow({ ai_status: "failed", ai_tier: null });
        if (sql.includes("FROM jobs WHERE id")) return { job_id: jobId, title: "Engineer", company: "Acme", location: null, seniority_level: null, description_text: "A reasonably detailed job description for scoring purposes here.".repeat(3), raw_description: null, requires_citizenship: false, citizenship_countries: null, export_control_restricted: false, eligibility_restriction_evidence: null };
        if (sql.includes("FROM candidates c LEFT JOIN")) return { id: candidateId, name: "Test Candidate", work_authorization: null, visa_status: null, preferred_locations: null, priority: "default", preferences: {}, custom_requirements: "" };
        if (sql.includes("FROM base_resumes WHERE id")) return { id: resumeId, candidate_id: candidateId, name: "Resume", target_industry: null, target_roles: null, content: "Resume text.", status: "approved" };
        return null;
      });
      mocks.callWithUsageTracking.mockResolvedValue({
        result: { tier, score: 72, reason: "Decent fit.", hardGates: [] },
        providerName: "opencode", model: "glm-5.3-flash", inputTokens: 10, outputTokens: 5, latencyMs: 100,
      });

      await retryAiScoring(queueId, "");

      expect(mocks.execute).toHaveBeenCalledWith(
        expect.stringContaining("ai_status = 'scored'"),
        tier === "reject"
          ? [queueId, null, 72, "AI assessment: not recommended. Decent fit.", JSON.stringify(["AI did not recommend this pairing; a human reviewer must decide."])]
          : [queueId, "adjacent", 72, "Decent fit.", JSON.stringify([])],
      );
      expect(mocks.createApplications).not.toHaveBeenCalled();
      expect(mocks.triggerAiWorkflowForApplication).not.toHaveBeenCalled();
    });

    it("records the failure reason and re-throws when the retry also fails", async () => {
      mocks.queryOne.mockImplementation(async (sql: string) => {
        if (sql.includes("FROM candidate_job_review_queue WHERE id")) return pendingRow({ ai_status: "failed", ai_tier: null });
        if (sql.includes("FROM jobs WHERE id")) return { job_id: jobId, title: "Engineer", company: "Acme", location: null, seniority_level: null, description_text: "A reasonably detailed job description for scoring purposes here.".repeat(3), raw_description: null, requires_citizenship: false, citizenship_countries: null, export_control_restricted: false, eligibility_restriction_evidence: null };
        if (sql.includes("FROM candidates c LEFT JOIN")) return { id: candidateId, name: "Test Candidate", work_authorization: null, visa_status: null, preferred_locations: null, priority: "default", preferences: {}, custom_requirements: "" };
        if (sql.includes("FROM base_resumes WHERE id")) return { id: resumeId, candidate_id: candidateId, name: "Resume", target_industry: null, target_roles: null, content: "Resume text.", status: "approved" };
        return null;
      });
      mocks.callWithUsageTracking.mockRejectedValue(new Error("Pool exhausted."));

      await expect(retryAiScoring(queueId, "")).rejects.toThrow();
      expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining("ai_status = 'failed'"), [queueId, "Pool exhausted."]);
    });

    it("refuses to retry an item that isn't pending", async () => {
      mocks.queryOne.mockResolvedValue(pendingRow({ status: "approved" }));
      await expect(retryAiScoring(queueId, "")).rejects.toThrow(/Only a pending item/);
    });
  });
});
