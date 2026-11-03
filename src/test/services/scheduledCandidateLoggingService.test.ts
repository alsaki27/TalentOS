import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(), queryOne: vi.fn(), execute: vi.fn(),
  scoreStage1: vi.fn(), scoreStage2: vi.fn(),
  fetchJobPageText: vi.fn(), isSafeExternalUrl: vi.fn(),
}));

vi.mock("@/server/db/neon", () => ({ query: mocks.query, queryOne: mocks.queryOne, execute: mocks.execute }));
vi.mock("@/server/services/candidateJobScoring", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/services/candidateJobScoring")>();
  return { ...actual, scoreStage1: mocks.scoreStage1, scoreStage2: mocks.scoreStage2 };
});
vi.mock("@/lib/ai/job-agents/fetchJobPage", () => ({ fetchJobPageText: mocks.fetchJobPageText, isSafeExternalUrl: mocks.isSafeExternalUrl }));

import { runScheduledCandidateLogging } from "@/server/services/scheduledCandidateLoggingService";

const runId = "99999999-9999-4999-8999-999999999999";
const eventId = "88888888-8888-4888-8888-888888888888";
const jobId = "77777777-7777-4777-8777-777777777777";
const candidateAId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const candidateBId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const resumeAId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const resumeBId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const assignedByUserId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const LONG_DESCRIPTION = "A detailed job description with enough content to clear the 250-character floor. ".repeat(4);

function baseConfig(overrides: Record<string, unknown> = {}) {
  return {
    is_enabled: true, match_threshold: 30, ai_match_threshold: 75,
    jobs_per_run: 100, ai_calls_per_run: 200, max_applications_per_run: 100,
    job_freshness_days: 2, custom_prompt: "", include_inactive_candidates: false,
    assigned_by_user_id: assignedByUserId, application_owner_user_id: assignedByUserId,
    ai_provider: null, ai_model: null, ai_base_url: null, ai_encrypted_api_key: null,
    ...overrides,
  };
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    event_id: eventId, job_id: jobId, source: "cron", ingested_at: "2026-11-01T00:00:00.000Z",
    title: "Engineer", company: "Acme", location: null, source_url: null, apply_url: null,
    description_text: LONG_DESCRIPTION, raw_description: null, posted_at: null,
    seniority_level: null, job_category: null, is_active: true,
    requires_citizenship: false, citizenship_countries: null,
    export_control_restricted: false, eligibility_restriction_evidence: null,
    ...overrides,
  };
}

function candidateRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, name: `Candidate ${id.slice(0, 4)}`, status: "active", pipeline_stage: "applying",
    work_authorization: null, visa_status: null, preferred_locations: null,
    priority: "default", preferences: {}, custom_requirements: "",
    ...overrides,
  };
}

function resumeRow(id: string, candidateId: string, overrides: Record<string, unknown> = {}) {
  return { id, candidate_id: candidateId, name: "Resume", target_industry: null, target_roles: null, content: "Resume text.", status: "approved", ...overrides };
}

describe("runScheduledCandidateLogging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue({ rowCount: 1 });
  });

  function wireQueryOne(options: {
    config?: Record<string, unknown>;
    priorDecisionsByCandidate?: Record<string, { status: string } | null>;
    existingApplication?: Record<string, unknown> | null;
    existingQueueItem?: Record<string, unknown> | null;
  } = {}) {
    const { config = baseConfig(), priorDecisionsByCandidate = {}, existingApplication = null, existingQueueItem = null } = options;
    mocks.queryOne.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM scheduled_candidate_logging_config")) return config;
      if (sql.includes("INSERT INTO scheduled_candidate_logging_runs")) return { id: runId, run_key: params[0], status: "running" };
      if (sql.includes("UPDATE scheduled_job_ingestion_events") && sql.includes("RETURNING id")) return { id: eventId };
      if (sql.includes("FROM scheduled_candidate_logging_decisions WHERE ingestion_event_id")) {
        const candidateId = params[1] as string;
        return priorDecisionsByCandidate[candidateId] ?? null;
      }
      if (sql.includes("FROM applications WHERE job_id")) return existingApplication;
      if (sql.includes("FROM candidate_job_review_queue WHERE job_id")) return existingQueueItem;
      if (sql.includes("INSERT INTO scheduled_candidate_logging_decisions")) return { id: `decision-${params[3]}` };
      return null;
    });
  }

  it("queues a Strong-tier pair for review and skips a Reject-tier pair, without creating any application directly", async () => {
    wireQueryOne();
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM scheduled_job_ingestion_events e JOIN jobs j")) return [job()];
      if (sql.includes("FROM candidates c")) return [candidateRow(candidateAId), candidateRow(candidateBId)];
      if (sql.includes("FROM base_resumes WHERE candidate_id")) return [resumeRow(resumeAId, candidateAId), resumeRow(resumeBId, candidateBId)];
      return [];
    });
    mocks.scoreStage1.mockImplementation((candidate: any) => ({
      bestResume: candidate.id === candidateAId ? resumeRow(resumeAId, candidateAId) : resumeRow(resumeBId, candidateBId),
      bestScore: candidate.id === candidateAId ? 90 : 60,
      hardGates: [],
      rankedResumes: [{ resumeId: candidate.id === candidateAId ? resumeAId : resumeBId, resumeName: "Resume", score: candidate.id === candidateAId ? 90 : 60 }],
    }));
    mocks.scoreStage2.mockImplementation(({ candidate }: any) => Promise.resolve(
      candidate.id === candidateAId
        ? { status: "scored", tier: "strong", score: 92, reason: "Great fit.", hardGates: [], provider: "opencode", model: "glm-5.3-flash", inputTokens: 10, outputTokens: 5 }
        : { status: "scored", tier: "reject", score: 20, reason: "Wrong field entirely.", hardGates: [], provider: "opencode", model: "glm-5.3-flash", inputTokens: 10, outputTokens: 5 },
    ));

    const result = await runScheduledCandidateLogging({ triggerType: "manual" });

    expect(result).toMatchObject({ runId, status: "completed", jobsSeen: 1, candidatePairsScored: 2, queuedForReview: 1, skippedCount: 1, failedCount: 0 });
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO candidate_job_review_queue"),
      expect.arrayContaining([candidateAId, jobId, resumeAId, 90, "scored", "strong"]),
    );
    expect(mocks.execute).not.toHaveBeenCalledWith(expect.stringContaining("INSERT INTO candidate_job_review_queue"), expect.arrayContaining([candidateBId]));
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("processing_status = 'complete'"), [eventId]);
  });

  it("queues ATS-only when Stage 2 fails, instead of dropping the pair", async () => {
    wireQueryOne();
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM scheduled_job_ingestion_events e JOIN jobs j")) return [job()];
      if (sql.includes("FROM candidates c")) return [candidateRow(candidateAId)];
      if (sql.includes("FROM base_resumes WHERE candidate_id")) return [resumeRow(resumeAId, candidateAId)];
      return [];
    });
    mocks.scoreStage1.mockReturnValue({ bestResume: resumeRow(resumeAId, candidateAId), bestScore: 90, hardGates: [], rankedResumes: [] });
    mocks.scoreStage2.mockResolvedValue({ status: "failed", provider: "opencode", model: "unknown", failureReason: "Pool exhausted." });

    const result = await runScheduledCandidateLogging({ triggerType: "manual" });

    expect(result).toMatchObject({ queuedForReview: 1, failedCount: 1 });
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO candidate_job_review_queue"),
      expect.arrayContaining([candidateAId, jobId, resumeAId, 90, "failed", null]),
    );
  });

  it("surfaces hard gates as warnings and still queues the pair, rather than excluding it", async () => {
    wireQueryOne();
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM scheduled_job_ingestion_events e JOIN jobs j")) return [job()];
      if (sql.includes("FROM candidates c")) return [candidateRow(candidateAId)];
      if (sql.includes("FROM base_resumes WHERE candidate_id")) return [resumeRow(resumeAId, candidateAId)];
      return [];
    });
    mocks.scoreStage1.mockReturnValue({
      bestResume: resumeRow(resumeAId, candidateAId), bestScore: 90,
      hardGates: ["Required security clearance is not proven by the resume"],
      rankedResumes: [],
    });
    mocks.scoreStage2.mockResolvedValue({ status: "scored", tier: "adjacent", score: 70, reason: "Decent fit.", hardGates: [], provider: "opencode", model: "glm-5.3-flash", inputTokens: 10, outputTokens: 5 });

    const result = await runScheduledCandidateLogging({ triggerType: "manual" });

    expect(result.queuedForReview).toBe(1);
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO candidate_job_review_queue"),
      expect.arrayContaining([JSON.stringify(["Required security clearance is not proven by the resume"])]),
    );
  });

  it("applies global dedup: a job already applied to for any candidate is skipped, not scored", async () => {
    wireQueryOne({ existingApplication: { id: "existing-app" } });
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM scheduled_job_ingestion_events e JOIN jobs j")) return [job()];
      if (sql.includes("FROM candidates c")) return [candidateRow(candidateAId)];
      if (sql.includes("FROM base_resumes WHERE candidate_id")) return [resumeRow(resumeAId, candidateAId)];
      return [];
    });

    const result = await runScheduledCandidateLogging({ triggerType: "manual" });

    expect(result.skippedCount).toBe(1);
    expect(result.candidatePairsScored).toBe(0);
    expect(mocks.scoreStage1).not.toHaveBeenCalled();
  });

  it("is a no-op when the feature is disabled", async () => {
    wireQueryOne({ config: baseConfig({ is_enabled: false }) });
    const result = await runScheduledCandidateLogging({ triggerType: "manual" });
    expect(result).toEqual({ skipped: true, reason: "Feature is disabled." });
    expect(mocks.scoreStage1).not.toHaveBeenCalled();
  });
});
