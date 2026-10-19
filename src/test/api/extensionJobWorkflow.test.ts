import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(), createApplications: vi.fn(), createJob: vi.fn(), execute: vi.fn(),
  query: vi.fn(), queryOne: vi.fn(), backgroundDispatch: vi.fn(), triggerWorkflow: vi.fn(),
  listCandidates: vi.fn(), getResumeOptions: vi.fn(), validateMatch: vi.fn(), recordActivity: vi.fn(),
  getSourceOfTruth: vi.fn(), parseSourceOfTruth: vi.fn(), callWithUsageTracking: vi.fn(),
}));

vi.mock("@/lib/extensionAuth", () => ({
  EXTENSION_SCOPES: { jobCapture: "extension:job:capture", applicationAssign: "extension:application:assign" },
  authenticateExtension: mocks.authenticate,
  checkIdempotencyKey: vi.fn(() => null),
  checkRequiredHeaders: vi.fn(() => null),
  extensionError: (code: string, message: string, status: number) => Response.json({ error: { code, message } }, { status }),
  withExtensionCors: (handler: (request: Request) => unknown) => handler,
}));
vi.mock("@/server/repositories/applicationsRepository", () => ({ createApplications: mocks.createApplications }));
vi.mock("@/server/repositories/jobsRepository", () => ({ createJob: mocks.createJob }));
vi.mock("@/server/db/neon", () => ({ query: mocks.query, queryOne: mocks.queryOne, execute: mocks.execute }));
vi.mock("@/server/lib/waitUntil", () => ({ backgroundDispatch: mocks.backgroundDispatch }));
vi.mock("@/server/services/applicationAiWorkflowService", () => ({ triggerAiWorkflowForApplication: mocks.triggerWorkflow }));
vi.mock("@/server/services/sourceOfTruthService", () => ({ getSourceOfTruth: mocks.getSourceOfTruth, parseSourceOfTruth: mocks.parseSourceOfTruth }));
vi.mock("@/lib/ai/routing", () => ({ callWithUsageTracking: mocks.callWithUsageTracking }));
vi.mock("@/server/services/extensionJobMatchService", () => ({
  listExtensionCandidates: mocks.listCandidates,
  getExtensionCandidateResumeOptions: mocks.getResumeOptions,
  validateExtensionResumeMatch: mocks.validateMatch,
}));
vi.mock("@/server/services/extensionActivityService", () => ({ recordExtensionActivity: mocks.recordActivity }));

import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/extension/v1/job-workflow/route";

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

describe("team extension job workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({ key: { id: "key-1", owner_user_id: actorId, scopes: ["extension:job:capture", "extension:application:assign"] } });
    mocks.queryOne.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM profiles")) {
        const id = params[0];
        if (id === ownerId) return { user_id: ownerId, display_name: "Assigned AE", email: "ae@example.com" };
        return { user_id: actorId, display_name: "Test Manager", email: "manager@example.com" };
      }
      if (sql.includes("FROM jobs")) return { id: jobId, title: "GIS Analyst", description_text: "GIS analyst role with detailed responsibilities", raw_description: null, eligibility_restriction_evidence: null };
      if (sql.includes("FROM applications")) return null;
      return null;
    });
    mocks.query.mockResolvedValue([{ user_id: ownerId, display_name: "Assigned AE", email: "ae@example.com", role: "application_engineer" }]);
    mocks.execute.mockResolvedValue({ rowCount: 1 });
    mocks.createJob.mockResolvedValue({ status: "created", job: { id: jobId, title: "GIS Analyst", company: "Northwind" } });
    mocks.createApplications.mockResolvedValue([{ id: "app-1", candidate_id: candidateId, job_id: jobId }]);
    mocks.recordActivity.mockResolvedValue(undefined);
    mocks.listCandidates.mockResolvedValue([{ candidateId, candidateName: "A. Candidate", pipelineStage: "applying" }]);
    mocks.getResumeOptions.mockResolvedValue({ candidateId, candidateName: "A. Candidate", pipelineStage: "applying", resumeOptions: [], bestResumeId: resumeId });
    mocks.validateMatch.mockResolvedValue({
      candidate: { candidateId, candidateName: "A. Candidate" },
      resume: { baseResumeId: resumeId, baseResumeName: "GIS Resume", score: 91, scoreType: "approved_profile", tier: "A", recommended: true, profileStatus: "approved", reason: "Strong fit" },
    });
    mocks.triggerWorkflow.mockResolvedValue({ started: true, workflowId: "wf-1" });
    mocks.getSourceOfTruth.mockResolvedValue({ lastParsedAt: "2026-10-18T00:00:00.000Z" });
  });

  it("returns the active candidate picker, base-resume scores, and assignment owners", async () => {
    const response = await GET(makeGetRequest() as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
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

  it("persists status, owner, due date, and note while starting the existing resume workflow", async () => {
    const response = await POST(makeRequest({
      action: "assign", jobId, selections: [{ candidateId, baseResumeId: resumeId }],
      assignmentStatus: "in_progress", assignedToUserId: ownerId, assignmentDueAt: "2026-10-30",
      assignmentNote: "Use the GIS resume and contact the candidate.",
    }, "assign-request") as never);

    expect(response.status).toBe(200);
    expect(mocks.createApplications).toHaveBeenCalledWith([expect.objectContaining({
      candidate_id: candidateId,
      job_id: jobId,
      status: "in_progress",
      base_resume_id: resumeId,
      assigned_by_user_id: actorId,
      assigned_to_user_id: ownerId,
      assigned_to: "Assigned AE",
      assignment_due_at: "2026-10-30",
      next_action: "Finish application submission.",
      follow_up_source: "auto_status_rule",
      assignment_note: expect.stringContaining("Use the GIS resume and contact the candidate."),
    })]);
    expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining("application_stage = 'in_ai_pipeline'"), ["app-1", actorId, "Test Manager"]);
    expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO application_events"), [
      "app-1", expect.any(String), actorId, "in_progress",
    ]);
    expect(mocks.recordActivity).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "candidate_logged", applicationId: "app-1", baseResumeId: resumeId, matchScore: 91,
      metadata: expect.objectContaining({ assignmentStatus: "in_progress", assignedToUserId: ownerId, assignmentDueAt: "2026-10-30" }),
    }));
    expect(mocks.backgroundDispatch).toHaveBeenCalled();
    expect((await response.json()).results[0]).toMatchObject({ status: "logged", resumeWorkflow: "starting" });
  });

  it("returns an explicit already-logged result without creating a duplicate application", async () => {
    mocks.queryOne.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM profiles")) {
        const id = params[0];
        if (id === ownerId) return { user_id: ownerId, display_name: "Assigned AE", email: "ae@example.com" };
        return { user_id: actorId, display_name: "Test Manager", email: "manager@example.com" };
      }
      if (sql.includes("FROM jobs")) return { id: jobId, title: "GIS Analyst", description_text: "GIS analyst role", raw_description: null };
      if (sql.includes("FROM applications")) return { id: "existing-app", candidate_name: "A. Candidate" };
      return null;
    });

    const response = await POST(makeRequest({
      action: "assign", jobId, selections: [{ candidateId, baseResumeId: resumeId }],
    }, "duplicate-assign") as never);

    expect(response.status).toBe(200);
    expect((await response.json()).results[0]).toMatchObject({
      candidateId, candidateName: "A. Candidate", applicationId: "existing-app", status: "already_logged",
      message: expect.stringContaining("No duplicate application was created"),
    });
    expect(mocks.createApplications).not.toHaveBeenCalled();
    expect(mocks.triggerWorkflow).not.toHaveBeenCalled();
  });

  it("requires an explicit confirmation for stored clearance flags before logging", async () => {
    mocks.queryOne.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM profiles")) {
        const id = params[0];
        if (id === ownerId) return { user_id: ownerId, display_name: "Assigned AE", email: "ae@example.com" };
        return { user_id: actorId, display_name: "Test Manager", email: "manager@example.com" };
      }
      if (sql.includes("FROM jobs")) return {
        id: jobId, title: "Defense GIS Analyst", description_text: "A detailed GIS role description.", raw_description: null,
        eligibility_restricted: true, requires_citizenship: false, citizenship_countries: null,
        export_control_restricted: true, eligibility_restriction_evidence: "Active security clearance required.",
      };
      if (sql.includes("FROM applications")) return null;
      return null;
    });

    const unconfirmed = await POST(makeRequest({
      action: "assign", jobId, selections: [{ candidateId, baseResumeId: resumeId }],
    }, "restricted-no-confirmation") as never);
    expect(unconfirmed.status).toBe(409);
    expect((await unconfirmed.json()).error.code).toBe("eligibility_ack_required");
    expect(mocks.createApplications).not.toHaveBeenCalled();

    const confirmed = await POST(makeRequest({
      action: "assign", jobId, selections: [{ candidateId, baseResumeId: resumeId }], acknowledgeEligibility: true,
    }, "restricted-confirmed") as never);
    expect(confirmed.status).toBe(200);
    expect(mocks.createApplications).toHaveBeenCalledTimes(1);
    expect(mocks.recordActivity).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "candidate_logged",
      metadata: expect.objectContaining({ eligibilityAcknowledged: true }),
    }));
  });

  it("keeps local relevance estimates out of the approved 0-100 match-score field", async () => {
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
    expect((await response.json()).results[0]).toMatchObject({
      status: "logged", matchScore: null, resumeScoreType: "local_resume_relevance", localResumeRelevancePoints: 12,
    });
  });
});
