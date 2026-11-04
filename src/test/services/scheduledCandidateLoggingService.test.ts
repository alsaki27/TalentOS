import { afterEach,beforeEach, describe, expect, it, vi } from "vitest";
import {writeFileSync} from "node:fs";

const mocks = vi.hoisted(() => ({
  query: vi.fn(), queryOne: vi.fn(), execute: vi.fn(),
  scoreStage1: vi.fn(), scoreStage2: vi.fn(),
  fetchJobPageText: vi.fn(), isSafeExternalUrl: vi.fn(),
  requestRun:vi.fn(),claimRun:vi.fn(),checkpoint:vi.fn(),leasedWrites:vi.fn(),activeRun:null as any,
}));

vi.mock("@/server/db/neon", () => ({ query: mocks.query, queryOne: mocks.queryOne, execute: mocks.execute }));
vi.mock("@/server/services/candidateJobScoring", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/services/candidateJobScoring")>();
  return { ...actual, scoreStage1: mocks.scoreStage1, scoreStage2: mocks.scoreStage2 };
});
vi.mock("@/lib/ai/job-agents/fetchJobPage", () => ({ fetchJobPageText: mocks.fetchJobPageText, isSafeExternalUrl: mocks.isSafeExternalUrl }));
vi.mock("@/server/services/scheduledLoggingExecution",async importOriginal => {
  const actual=await importOriginal<typeof import("@/server/services/scheduledLoggingExecution")>();
  return {...actual,requestLoggingRun:mocks.requestRun,claimLoggingRun:mocks.claimRun,
    checkpointLoggingRun:mocks.checkpoint,leasedWrites:mocks.leasedWrites};
});

import { runScheduledCandidateLogging,continueScheduledCandidateLogging,enqueueScheduledCandidateLogging } from "@/server/services/scheduledCandidateLoggingService";

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
  afterEach(context=>{
    if(process.env.TALENTOS_SQL_PLAN_OUTPUT && context.task.name.includes("Strong-tier pair")) {
      writeFileSync(process.env.TALENTOS_SQL_PLAN_OUTPUT+".decisions",JSON.stringify(mocks.leasedWrites.mock.calls.flatMap(([,statements])=>statements)));
    }
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue({ rowCount: 1 });
    mocks.activeRun=null;
    mocks.requestRun.mockImplementation(async input => {
      const selected=await mocks.query("FROM scheduled_job_ingestion_events e JOIN jobs j");
      const state={version:1,phase:"queued",heartbeatAt:new Date().toISOString(),leaseToken:null,leaseUntil:null,
        currentEventId:null,eventIds:selected.map((j:any)=>j.event_id),startedEventIds:[],completedEventIds:[],recoveries:0};
      mocks.activeRun={id:runId,status:"running",config_snapshot:{...input.snapshot,execution:state},jobs_seen:0,
        candidate_pairs_scored:0,applications_created:0,skipped_count:0,failed_count:0,ai_calls:0,input_tokens:0,output_tokens:0};
      return mocks.activeRun;
    });
    mocks.claimRun.mockImplementation(async (claim=true) => {
      if(!claim || !mocks.activeRun || mocks.activeRun.status!=="running")return null;
      mocks.activeRun.config_snapshot.execution={...mocks.activeRun.config_snapshot.execution,
        phase:"working",leaseToken:"lease-fixture",leaseUntil:new Date(Date.now()+180000).toISOString()};
      return mocks.activeRun;
    });
    mocks.checkpoint.mockImplementation(async (run,state,status="running")=>{run.config_snapshot.execution=structuredClone(state);run.status=status;});
    mocks.leasedWrites.mockImplementation(async (_run,statements) => Promise.all(statements.map(async({text,values}:any)=> {
      if(text.includes("INSERT INTO candidate_job_review_queue")) {await mocks.execute(text,values);return [{id:"review"}];}
      if(text.includes("UPDATE scheduled_job_ingestion_events")) {const row=await mocks.queryOne(text,values);await mocks.query(text,values);return row?[row]:[];}
      if(text.includes("INSERT INTO scheduled_candidate_logging_decisions")) {const row=await mocks.queryOne(text,values);return row?[row]:[];}
      return [];
    })));
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
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("processing_status=$2"),expect.arrayContaining([eventId,"complete"]));
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

  function wireSingleCandidate(config = baseConfig(), jobs = [job()]) {
    wireQueryOne({ config });
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM scheduled_job_ingestion_events e JOIN jobs j")) return jobs;
      if (sql.includes("FROM candidates c")) return [candidateRow(candidateAId)];
      if (sql.includes("FROM base_resumes WHERE candidate_id")) return [resumeRow(resumeAId, candidateAId, { status: "draft" })];
      return [];
    });
    mocks.scoreStage1.mockReturnValue({ bestResume: resumeRow(resumeAId, candidateAId), bestScore: 30, hardGates: [], rankedResumes: [] });
    mocks.scoreStage2.mockResolvedValue({ status: "scored", tier: "strong", score: 80, reason: "Fit", hardGates: [],
      provider: "opencode", model: "glm-5.3-flash", inputTokens: 10, outputTokens: 5 });
  }

  it("spends no AI tokens on a pair below the saved Stage 1 floor", async () => {
    wireSingleCandidate();
    mocks.scoreStage1.mockReturnValue({ bestResume: resumeRow(resumeAId, candidateAId), bestScore: 29, hardGates: [], rankedResumes: [] });
    const result = await runScheduledCandidateLogging({ triggerType: "manual" });
    expect(result).toMatchObject({ aiCalls: 0, queuedForReview: 0, skippedCount: 1 });
    expect(mocks.scoreStage2).not.toHaveBeenCalled();
  });

  it("admits the exact ATS boundary, draft resumes, and the saved AI cross-check floor", async () => {
    wireSingleCandidate(baseConfig({ ai_match_threshold: 30 }));
    const result = await runScheduledCandidateLogging({ triggerType: "manual" });
    expect(result).toMatchObject({ aiCalls: 1, queuedForReview: 1 });
    expect(mocks.scoreStage2).toHaveBeenCalledWith(expect.objectContaining({ deterministicScore: 30, crossCheckFloor: 30 }));
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("status IN ('draft', 'approved')"), expect.any(Array));
    expect(mocks.checkpoint).toHaveBeenCalledWith(expect.objectContaining({id:runId,ai_calls:1,applications_created:1}),expect.any(Object));
  });

  it.each(["ai_calls_per_run", "max_applications_per_run"])("obeys %s without spending AI on deferred jobs", async cap => {
    wireSingleCandidate(baseConfig({ [cap]: 1 }), [job(), job({ event_id: "second-event", job_id: "second-job" })]);
    const result = await runScheduledCandidateLogging({ triggerType: "manual" });
    expect(result).toMatchObject({ status: "partial", aiCalls: 1, queuedForReview: 1, pending: true });
    expect(mocks.scoreStage2).toHaveBeenCalledTimes(1);
    expect(mocks.activeRun.config_snapshot.execution.completedEventIds).not.toContain("second-event");
  });

  it("does not score a job claimed by another batch", async () => {
    wireSingleCandidate();
    const previous = mocks.queryOne.getMockImplementation()!;
    mocks.queryOne.mockImplementation((sql: string, params: unknown[]) => sql.includes("UPDATE scheduled_job_ingestion_events") ? null : previous(sql, params));
    const result = await runScheduledCandidateLogging({ triggerType: "manual" });
    expect(result.jobsSeen).toBe(0);
    expect(mocks.scoreStage1).not.toHaveBeenCalled();
    expect(mocks.scoreStage2).not.toHaveBeenCalled();
  });

  it("accepts a batch without invoking Stage 1 or Stage 2",async()=>{
    wireSingleCandidate();
    const result=await enqueueScheduledCandidateLogging({triggerType:"manual"});
    expect(result).toMatchObject({status:"running",phase:"queued",aiCalls:0});
    expect(mocks.scoreStage1).not.toHaveBeenCalled();expect(mocks.scoreStage2).not.toHaveBeenCalled();
  });

  it("yields at the chunk deadline and keeps the saved AI budget on continuation",async()=>{
    wireSingleCandidate(baseConfig({ai_calls_per_run:2}),[job(),job({event_id:"second-event",job_id:"second-job"})]);
    const clock=vi.spyOn(Date,"now").mockReturnValue(100000);
    mocks.scoreStage2.mockImplementationOnce(async()=>{
      clock.mockReturnValue(145000);
      return {status:"scored",tier:"strong",score:80,reason:"Fit",hardGates:[],provider:"opencode",model:"glm-5.3-flash",inputTokens:10,outputTokens:5};
    });
    try {
      const first=await runScheduledCandidateLogging({triggerType:"manual"});
      expect(first).toMatchObject({status:"running",phase:"queued",aiCalls:1,queuedForReview:1});
      expect(mocks.activeRun.config_snapshot.execution.completedEventIds).toEqual([eventId]);
      clock.mockReturnValue(160000);
      mocks.query.mockImplementation(async sql=>sql.includes("FROM scheduled_job_ingestion_events e JOIN jobs j")?[job({event_id:"second-event",job_id:"second-job"})]
        :sql.includes("FROM candidates c")?[candidateRow(candidateAId)]:sql.includes("FROM base_resumes WHERE")?[resumeRow(resumeAId,candidateAId)]:[]);
      const second=await continueScheduledCandidateLogging();
      expect(second).toMatchObject({status:"completed",aiCalls:2,queuedForReview:2,jobsSeen:2});
      expect(mocks.scoreStage2).toHaveBeenCalledTimes(2);
    } finally {clock.mockRestore();}
  });

  it("defers a cooling/exhausted AI pool rather than flooding review with ATS-only items",async()=>{
    wireSingleCandidate();
    mocks.scoreStage2.mockResolvedValue({status:"failed",provider:"opencode",model:"glm-5.3-flash",failureReason:"All keys cooling",retryAfterMs:60000});
    const result=await runScheduledCandidateLogging({triggerType:"manual"});
    expect(result).toMatchObject({status:"running",phase:"waiting",aiCalls:1,queuedForReview:0,failedCount:1});
    expect(mocks.execute).not.toHaveBeenCalledWith(expect.stringContaining("INSERT INTO candidate_job_review_queue"),expect.anything());
    expect(mocks.activeRun.config_snapshot.execution.nextAttemptAt).toBeTruthy();
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("processing_status=$2"),expect.arrayContaining([eventId,"pending"]));
  });

  it("does no work if a different chunk already owns the batch lease",async()=>{
    wireSingleCandidate();mocks.claimRun.mockResolvedValue(null);
    const result=await continueScheduledCandidateLogging();
    expect(result).toMatchObject({skipped:true});expect(mocks.scoreStage2).not.toHaveBeenCalled();
  });

  it("rejects a result from an executor that lost its lease while AI was running",async()=>{
    wireSingleCandidate();
    const {ScheduledLoggingLeaseLost}=await import("@/server/services/scheduledLoggingExecution");
    mocks.scoreStage2.mockImplementation(async()=>{
      mocks.checkpoint.mockRejectedValueOnce(new ScheduledLoggingLeaseLost());
      return {status:"scored",tier:"strong",score:90,reason:"Fit",hardGates:[],provider:"opencode",model:"glm-5.3-flash",inputTokens:10,outputTokens:5};
    });
    expect(await runScheduledCandidateLogging({triggerType:"manual"})).toMatchObject({leaseLost:true});
    expect(mocks.execute).not.toHaveBeenCalledWith(expect.stringContaining("INSERT INTO candidate_job_review_queue"),expect.anything());
  });

  it("releases the claimed event and records a failed run on a normal storage error",async()=>{
    wireSingleCandidate();mocks.scoreStage1.mockImplementation(()=>{throw new Error("Storage fixture failed");});
    await expect(runScheduledCandidateLogging({triggerType:"manual"})).rejects.toThrow("Storage fixture failed");
    expect(mocks.activeRun.status).toBe("failed");
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("processing_status=$2"),expect.arrayContaining([eventId,"pending"]));
  });

  it("automatically retries bounded transient connection failures without discarding saved progress",async()=>{
    wireSingleCandidate();mocks.scoreStage1.mockImplementation(()=>{throw new Error("Connection terminated unexpectedly");});
    expect(await runScheduledCandidateLogging({triggerType:"manual"})).toMatchObject({status:"running",phase:"waiting",retrying:true});
    expect(mocks.activeRun.config_snapshot.execution.recoveries).toBe(1);
    expect(mocks.activeRun.config_snapshot.execution.nextAttemptAt).toBeTruthy();
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("processing_status=$2"),expect.arrayContaining([eventId,"pending"]));
  });
});
