import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(), createJob: vi.fn(), execute: vi.fn(),
  query: vi.fn(), queryOne: vi.fn(),
  listCandidates: vi.fn(), getResumeOptions: vi.fn(), validateMatch: vi.fn(), recordActivity: vi.fn(),
  callWithUsageTracking: vi.fn(),
  createApplications: vi.fn(), triggerWorkflow: vi.fn(),
}));

vi.mock("@/lib/extensionAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/extensionAuth")>();
  return {
    ...actual,
    EXTENSION_SCOPES: { jobCapture: "extension:job:capture", applicationAssign: "extension:application:assign" },
    authenticateExtension: mocks.authenticate,
    checkIdempotencyKey: vi.fn(() => null),
    checkRequiredHeaders: vi.fn(() => null),
    extensionError: (code: string, message: string, status: number) => Response.json({ error: { code, message } }, { status }),
  };
});
vi.mock("@/server/repositories/jobsRepository", () => ({ createJob: mocks.createJob }));
vi.mock("@/server/repositories/applicationsRepository", () => ({ createApplications: mocks.createApplications }));
vi.mock("@/server/services/applicationAiWorkflowService", () => ({ triggerAiWorkflowForApplication: mocks.triggerWorkflow }));
vi.mock("@/server/db/neon", () => ({ query: mocks.query, queryOne: mocks.queryOne, execute: mocks.execute }));
vi.mock("@/lib/ai/routing", () => ({
  callWithUsageTracking: mocks.callWithUsageTracking,
  // scoreStage2's catch block checks `error instanceof AiRouteCallError` -
  // without a real (stub) class here, that check throws on any rejection.
  AiRouteCallError: class AiRouteCallError extends Error {
    provider?: string; model?: string;
    constructor(message: string, provider?: string, model?: string) { super(message); this.provider = provider; this.model = model; }
  },
}));
vi.mock("@/server/services/extensionJobMatchService", () => ({
  listExtensionCandidates: mocks.listCandidates,
  getExtensionCandidateResumeOptions: mocks.getResumeOptions,
  validateExtensionResumeMatch: mocks.validateMatch,
}));
vi.mock("@/server/services/extensionActivityService", () => ({ recordExtensionActivity: mocks.recordActivity }));

import { NextRequest } from "next/server";
import { GET, OPTIONS, POST } from "@/app/api/extension/v1/job-workflow/route";
import * as scoring from "@/server/services/candidateJobScoring";

const jobId = "11111111-1111-4111-8111-111111111111";
const candidateId = "22222222-2222-4222-8222-222222222222";
const resumeId = "33333333-3333-4333-8333-333333333333";
const ownerId = "44444444-4444-4444-8444-444444444444";
const actorId = "55555555-5555-4555-8555-555555555555";

function makeRequest(body: unknown, idempotencyKey = "request-1") {
  return new NextRequest("https://talentos.test/api/extension/v1/job-workflow", {
    method: "POST",
    headers: { "content-type": "application/json", "x-talentos-client": "job-capture-test", "idempotency-key": idempotencyKey },
    body: JSON.stringify(body),
  });
}

function makeGetRequest(query = "") {
  return new NextRequest(`https://talentos.test/api/extension/v1/job-workflow?jobId=${jobId}${query}`, {
    method: "GET", headers: { "x-talentos-client": "job-capture-test" },
  });
}

import { POST as captureOnly } from "@/app/api/extension/v1/capture-job/route";

const LONG_DESCRIPTION = "GIS analyst role with detailed responsibilities. ".repeat(10);

function defaultQueryOneImpl(sql: string, params: unknown[] = []) {
  if (sql.includes("FROM profiles")) {
    const id = params[0];
    if (id === ownerId) return { user_id: ownerId, display_name: "Assigned AE", email: "ae@example.com" };
    return { user_id: actorId, display_name: "Test Manager", email: "manager@example.com" };
  }
  if (sql.includes("FROM jobs")) return { id: jobId, title: "GIS Analyst", company: "Northwind", location: null, seniority_level: null, description_text: LONG_DESCRIPTION, raw_description: null, eligibility_restriction_evidence: null, posted_at: null, created_at: "2026-10-01T00:00:00.000Z" };
  // Global dedup checks - no existing application, no existing queue item.
  if (sql.includes("FROM applications a")) return null;
  if (sql.includes("FROM candidate_job_review_queue WHERE job_id")) return null;
  // candidateJobReviewQueueService-style candidate/resume lookups for scoring.
  if (sql.includes("FROM candidates c LEFT JOIN scheduled_candidate_logging_candidate_rules")) {
    return { id: candidateId, name: "A. Candidate", work_authorization: null, visa_status: null, preferred_locations: null, priority: "default", preferences: {}, custom_requirements: "" };
  }
  if (sql.includes("FROM base_resumes WHERE id")) {
    return { id: resumeId, candidate_id: candidateId, name: "GIS Resume", target_industry: "GIS", target_roles: ["GIS analyst"], content: "GIS analyst with detailed responsibilities.", status: "approved" };
  }
  if (sql.includes("FROM scheduled_candidate_logging_config")) return { custom_prompt: "" };
  if (sql.includes("INSERT INTO candidate_job_review_queue")) return { id: "queue-1" };
  return null;
}

describe("team extension job workflow", () => {
  // Regression guard for every capture/assign path: only the separately
  // authorized Review Queue approval route may create or start an application.
  afterEach(() => {
    expect(mocks.createApplications).not.toHaveBeenCalled();
    expect(mocks.triggerWorkflow).not.toHaveBeenCalled();
    const pipelineWrites = mocks.execute.mock.calls.filter(([sql]) => /(?:INSERT INTO|UPDATE)\s+applications\b|INSERT INTO\s+application_events\b/i.test(sql));
    expect(pipelineWrites).toEqual([]);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({ key: { id: "key-1", owner_user_id: actorId, scopes: ["extension:job:capture", "extension:application:assign"] } });
    mocks.queryOne.mockImplementation(async (sql: string, params: unknown[] = []) => defaultQueryOneImpl(sql, params));
    mocks.query.mockResolvedValue([{ user_id: ownerId, display_name: "Assigned AE", email: "ae@example.com", role: "application_engineer" }]);
    mocks.execute.mockResolvedValue({ rowCount: 1 });
    mocks.createJob.mockResolvedValue({ status: "created", job: { id: jobId, title: "GIS Analyst", company: "Northwind" } });
    mocks.recordActivity.mockResolvedValue(undefined);
    mocks.listCandidates.mockResolvedValue([{ candidateId, candidateName: "A. Candidate", pipelineStage: "applying" }]);
    mocks.getResumeOptions.mockResolvedValue({ candidateId, candidateName: "A. Candidate", pipelineStage: "applying", resumeOptions: [], bestResumeId: resumeId });
    mocks.validateMatch.mockResolvedValue({
      candidate: { candidateId, candidateName: "A. Candidate" },
      resume: { baseResumeId: resumeId, baseResumeName: "GIS Resume", score: 91, scoreType: "approved_profile", tier: "A", recommended: true, profileStatus: "approved", reason: "Strong fit" },
    });
    // scoreStage2 destructures { result, providerName, model, inputTokens, outputTokens, latencyMs }
    // from callWithUsageTracking's return - this is Stage 2's successful path.
    mocks.callWithUsageTracking.mockResolvedValue({
      result: { tier: "strong", score: 88, reason: "Good fit.", hardGates: [] },
      providerName: "opencode", model: "glm-5.3-flash", inputTokens: 100, outputTokens: 50, latencyMs: 500,
    });
  });

  it("answers the candidate workflow preflight with the extension CORS headers", async () => {
    const origin = "chrome-extension://kpenlaknocoaehpmagoihofcfpnejdhh";
    const request = new NextRequest("https://talentos.test/api/extension/v1/job-workflow", {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type,idempotency-key,x-talentos-client",
      },
    });

    const response = await OPTIONS(request);

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    expect(response.headers.get("access-control-allow-headers")).toContain("Idempotency-Key");
    expect(response.headers.get("access-control-allow-headers")).toContain("X-TalentOS-Client");
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it("returns the active candidate picker, base-resume scores, and assignment owners", async () => {
    const response = await GET(makeGetRequest() as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      assignmentMode: "human_review", reviewQueueUrl: "/candidate-job-review",
      candidates: [{ candidateId, candidateName: "A. Candidate" }],
      owners: [{ userId: ownerId, name: "Assigned AE" }],
      assignedBy: "Test Manager",
      defaultOwnerUserId: actorId,
    });
    expect(mocks.listCandidates).toHaveBeenCalledWith(jobId);
  });

  it("returns resume options for the candidate selected from the dropdown", async () => {
    const response = await GET(makeGetRequest(`&candidateId=${candidateId}`) as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ candidate: { candidateId, bestResumeId: resumeId } });
    expect(mocks.getResumeOptions).toHaveBeenCalledWith(jobId, candidateId);
  });

  it("blocks a restricted job until the user explicitly acknowledges it", async () => {
    const response = await POST(makeRequest({
      action: "capture", title: "Engineer", company: "Defense Co", applyUrl: "https://jobs.test/apply",
      jdText: "Applicants must be U.S. citizens and have active security clearance.",
    }) as never);

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("eligibility_ack_required");
    expect(mocks.createJob).not.toHaveBeenCalled();
  });

  it("captures an acknowledged job and opens the candidate picker even without automatic recommendations", async () => {
    mocks.createJob.mockResolvedValue({ status: "duplicate", existing: { id: jobId, title: "GIS Analyst", company: "Northwind" } });
    const response = await POST(makeRequest({
      action: "capture", title: "Engineer", company: "Defense Co", applyUrl: "https://jobs.test/apply",
      jdText: "Applicants must be U.S. citizens and have active security clearance.",
      acknowledgeEligibility: true, matchCandidates: true,
    }) as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.duplicate).toBe(true);
    expect(body.candidateMatching).toMatchObject({ status: "ready" });
    expect(mocks.recordActivity).toHaveBeenCalledWith(expect.objectContaining({ eventType: "job_duplicate", jobId }));
  });

  it("scores the pair (ATS + AI) and queues it for review instead of creating an application directly", async () => {
    const response = await POST(makeRequest({
      action: "assign", jobId, selections: [{ candidateId, baseResumeId: resumeId }],
      assignmentStatus: "in_progress", assignedToUserId: ownerId, assignmentDueAt: "2026-10-30",
      assignmentNote: "Use the GIS resume and contact the candidate.",
    }, "assign-request") as never);

    expect(response.status).toBe(200);
    // The capture/pick/log steps are unchanged - the only behavior change is
    // what happens after: a scored queue row, not a direct application.
    expect(mocks.queryOne).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO candidate_job_review_queue"),
      expect.arrayContaining([candidateId, jobId, resumeId]),
    );
    expect(mocks.callWithUsageTracking).toHaveBeenCalled();
    expect(mocks.recordActivity).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "candidate_logged", candidateId, baseResumeId: resumeId, matchScore: 91,
      metadata: expect.objectContaining({ assignmentStatus: "in_progress", assignedToUserId: ownerId, assignmentDueAt: "2026-10-30", aiStatus: "scored", aiTier: "strong" }),
    }));
    const result = (await response.json()).results[0];
    expect(result).toMatchObject({ status: "submitted_for_review", aiStatus: "scored", aiTier: "strong", reviewQueueId: "queue-1", applicationCreated: false, workflowStarted: false });
    expect(result.atsScore).toEqual(expect.any(Number));
  });

  it("queues the pair ATS-only when the AI eligibility check fails, instead of blocking it", async () => {
    mocks.callWithUsageTracking.mockRejectedValue(new Error("Shared OpenCode pool exhausted."));
    const response = await POST(makeRequest({
      action: "assign", jobId, selections: [{ candidateId, baseResumeId: resumeId }],
    }, "assign-ai-fails") as never);

    expect(response.status).toBe(200);
    expect(mocks.queryOne).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO candidate_job_review_queue"),
      expect.arrayContaining(["failed"]),
    );
    const result = (await response.json()).results[0];
    expect(result).toMatchObject({ status: "submitted_for_review", aiStatus: "failed" });
  });

  it.each([0, 12, 29, 30])("always queues an extension submission with ATS %s for human review", async atsScore => {
    const score = vi.spyOn(scoring, "scoreStage1").mockReturnValueOnce({
      bestResume: { id: resumeId, candidate_id: candidateId, name: "Selected resume", content: "Resume", status: "draft", target_industry: null, target_roles: null },
      bestScore: atsScore, hardGates: [], rankedResumes: [],
    });
    try {
      const response = await POST(makeRequest({ action: "assign", jobId, selections: [{ candidateId, baseResumeId: resumeId }] }));
      expect((await response.json()).results[0]).toMatchObject({ atsScore, status: "submitted_for_review", applicationCreated: false, workflowStarted: false });
      expect(mocks.queryOne).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO candidate_job_review_queue"), expect.arrayContaining([atsScore, "scored"]));
    } finally { score.mockRestore(); }
  });

  it("queues an AI-rejected extension pairing without violating the review tier constraint", async () => {
    mocks.callWithUsageTracking.mockResolvedValue({ result: { tier: "reject", score: 0, reason: "Different profession", hardGates: ["Required license not evidenced"] },
      providerName: "opencode", model: "glm-5.3-flash", inputTokens: 100, outputTokens: 50, latencyMs: 500 });
    const response = await POST(makeRequest({ action: "assign", jobId, selections: [{ candidateId, baseResumeId: resumeId }] }));
    expect((await response.json()).results[0]).toMatchObject({ status: "submitted_for_review", aiStatus: "scored", aiTier: null, aiRecommendation: "reject", aiScore: 0 });
    const insert = mocks.queryOne.mock.calls.find(([sql]) => sql.includes("INSERT INTO candidate_job_review_queue"));
    expect(insert?.[1][5]).toBeNull();
    expect(insert?.[1][7]).toContain("not recommended");
    expect(JSON.parse(insert?.[1][9])).toContain("Required license not evidenced");
  });

  it("fails closed when the review queue cannot be written, without falling back to the pipeline", async () => {
    mocks.queryOne.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("INSERT INTO candidate_job_review_queue")) throw new Error("Review queue temporarily unavailable");
      return defaultQueryOneImpl(sql, params);
    });
    const response = await POST(makeRequest({ action: "assign", jobId, selections: [{ candidateId, baseResumeId: resumeId }] }));
    expect(await response.json()).toMatchObject({ assignmentMode: "human_review", completed: 0, failed: 1,
      results: [{ status: "failed", error: "Review queue temporarily unavailable" }] });
  });

  it("queues short descriptions without an AI call or a direct workflow", async () => {
    mocks.queryOne.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const row = defaultQueryOneImpl(sql, params);
      return sql.includes("FROM jobs") ? { ...row, description_text: "GIS role" } : row;
    });
    const response = await POST(makeRequest({ action: "assign", jobId, selections: [{ candidateId, baseResumeId: resumeId }] }));
    expect((await response.json()).results[0]).toMatchObject({ status: "submitted_for_review", aiStatus: "failed", workflowStarted: false });
    expect(mocks.callWithUsageTracking).not.toHaveBeenCalled();
  });

  it("preserves AI eligibility warnings for human review even for a stretch match", async () => {
    mocks.callWithUsageTracking.mockResolvedValue({ result: { tier: "stretch", score: 25, reason: "Domain gap", hardGates: ["Required clearance is not evidenced"] },
      providerName: "opencode", model: "glm-5.3-flash", inputTokens: 100, outputTokens: 50, latencyMs: 500 });
    const response = await POST(makeRequest({ action: "assign", jobId, selections: [{ candidateId, baseResumeId: resumeId }], assignmentStatus: "in_progress" }));
    expect((await response.json()).results[0]).toMatchObject({ status: "submitted_for_review", aiTier: "stretch", workflowStarted: false });
    const insert = mocks.queryOne.mock.calls.find(([sql]) => sql.includes("INSERT INTO candidate_job_review_queue"));
    expect(insert?.[0]).toContain("'pending'");
    expect(JSON.parse(insert?.[1][9])).toContain("Required clearance is not evidenced");
  });

  it("returns an explicit already-logged result without creating a duplicate when the job already has an application for any candidate", async () => {
    mocks.queryOne.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM applications a")) return { id: "existing-app", candidate_name: "Someone Else" };
      return defaultQueryOneImpl(sql, params);
    });

    const response = await POST(makeRequest({
      action: "assign", jobId, selections: [{ candidateId, baseResumeId: resumeId }],
    }, "duplicate-assign") as never);

    expect(response.status).toBe(200);
    expect((await response.json()).results[0]).toMatchObject({
      candidateId, applicationId: "existing-app", status: "already_logged",
      message: expect.stringContaining("No duplicate"),
    });
    expect(mocks.callWithUsageTracking).not.toHaveBeenCalled();
  });

  it("returns already-pending-review when another candidate already has a pending/approved item for this job", async () => {
    mocks.queryOne.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM candidate_job_review_queue WHERE job_id")) return { id: "queue-existing" };
      return defaultQueryOneImpl(sql, params);
    });

    const response = await POST(makeRequest({
      action: "assign", jobId, selections: [{ candidateId, baseResumeId: resumeId }],
    }, "pending-review-assign") as never);

    expect(response.status).toBe(200);
    expect((await response.json()).results[0]).toMatchObject({ candidateId, status: "already_pending_review" });
    expect(mocks.callWithUsageTracking).not.toHaveBeenCalled();
  });

  it("requires an explicit confirmation for stored clearance flags before logging", async () => {
    mocks.queryOne.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM jobs")) return {
        id: jobId, title: "Defense GIS Analyst", company: "Northwind", location: null, seniority_level: null,
        description_text: LONG_DESCRIPTION, raw_description: null,
        eligibility_restricted: true, requires_citizenship: false, citizenship_countries: null,
        export_control_restricted: true, eligibility_restriction_evidence: "Active security clearance required.",
        posted_at: null, created_at: "2026-10-01T00:00:00.000Z",
      };
      return defaultQueryOneImpl(sql, params);
    });

    const unconfirmed = await POST(makeRequest({
      action: "assign", jobId, selections: [{ candidateId, baseResumeId: resumeId }],
    }, "restricted-no-confirmation") as never);
    expect(unconfirmed.status).toBe(409);
    expect((await unconfirmed.json()).error.code).toBe("eligibility_ack_required");

    const confirmed = await POST(makeRequest({
      action: "assign", jobId, selections: [{ candidateId, baseResumeId: resumeId }], acknowledgeEligibility: true,
    }, "restricted-confirmed") as never);
    expect(confirmed.status).toBe(200);
    expect(mocks.recordActivity).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "candidate_logged",
      metadata: expect.objectContaining({ eligibilityAcknowledged: true }),
    }));
  });

  it("still queues the pair for review when the local resume relevance estimate is low, rather than excluding it", async () => {
    mocks.validateMatch.mockResolvedValue({
      candidate: { candidateId, candidateName: "A. Candidate" },
      resume: { baseResumeId: resumeId, baseResumeName: "Draft GIS Resume", score: 12, scoreType: "local_resume_relevance", tier: null, recommended: false, profileStatus: "not_approved", reason: "Local match estimate" },
    });
    const response = await POST(makeRequest({ action: "assign", jobId, selections: [{ candidateId, baseResumeId: resumeId }] }, "local-score-request") as never);

    expect(response.status).toBe(200);
    expect(mocks.recordActivity).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "candidate_logged", matchScore: null,
      metadata: expect.objectContaining({ scoreType: "local_resume_relevance", localResumeRelevancePoints: 12 }),
    }));
    expect((await response.json()).results[0]).toMatchObject({ status: "submitted_for_review" });
  });

  function mockHiddenCopy() {
    const previous = mocks.queryOne.getMockImplementation()!;
    const canonicalId = "00cfcd73-a337-4fdd-bc4b-777ac893adab";
    mocks.queryOne.mockImplementation(async (sql: string, params: unknown[] = []) => sql.includes("FROM jobs")
      ? (params[0] === jobId
        ? { id: jobId, is_active: false, content_duplicate_of: canonicalId }
        : { id: canonicalId, is_active: true, title: "GIS Analyst", company: "Northwind", location: null, seniority_level: null, description_text: LONG_DESCRIPTION, raw_description: null, posted_at: null, created_at: "2026-10-01T00:00:00.000Z" })
      : previous(sql, params));
    return canonicalId;
  }

  it("loads candidates against the active original when the requested ID is a hidden copy", async () => {
    const canonicalId = mockHiddenCopy();
    const response = await GET(makeGetRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ jobId: canonicalId, jobStatus: { state: "active", redirected: true } });
    expect(mocks.listCandidates).toHaveBeenCalledWith(canonicalId);
  });

  it.each([["workflow", POST], ["capture-only", captureOnly]])("returns the active original after %s capture creates a hidden duplicate", async (_name, handler) => {
    const canonicalId = mockHiddenCopy();
    const response = await handler(makeRequest({ title: "GIS Analyst", company: "Northwind", applyUrl: "https://jobs.test/job/1", jdText: "A job description with GIS responsibilities." }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ jobId: canonicalId, duplicate: true, jobStatus: { state: "active" } });
    expect(mocks.recordActivity).toHaveBeenCalledWith(expect.objectContaining({ jobId: canonicalId, eventType: "job_duplicate" }));
  });

  it("uses the original job when assigning a candidate from a hidden-copy link", async () => {
    const canonicalId = mockHiddenCopy();
    const response = await POST(makeRequest({ action: "assign", jobId, selections: [{ candidateId, baseResumeId: resumeId }] }));
    expect(response.status).toBe(200);
    expect(mocks.queryOne).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO candidate_job_review_queue"),
      expect.arrayContaining([candidateId, canonicalId]),
    );
  });

  it("reports a stored inactive job separately from a missing job", async () => {
    const previous = mocks.queryOne.getMockImplementation()!;
    mocks.queryOne.mockImplementation(async (sql: string, params: unknown[] = []) => sql.includes("FROM jobs") ? { id: jobId, is_active: false } : previous(sql, params));
    const response = await GET(makeGetRequest());
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("job_inactive");
    expect(mocks.listCandidates).not.toHaveBeenCalled();
  });

  it.each([["workflow", POST], ["capture-only", captureOnly]])("refuses to store Home as the employer through %s capture", async (_name, handler) => {
    const response = await handler(makeRequest({ title: "Analyst", company: "Home", applyUrl: "https://indeed.com/viewjob?jk=abc", jdText: "Detailed analyst responsibilities" }));
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("invalid_employer");
    expect(mocks.createJob).not.toHaveBeenCalled();
  });

});
