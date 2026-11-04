import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ queryOne: vi.fn(), scoreStage2: vi.fn(), fetch: vi.fn() }));

// Neither the database adapter nor the AI/provider graph is loaded in this suite.
vi.mock("@/server/db/neon", () => ({ queryOne: mocks.queryOne }));
vi.mock("@/server/services/candidateJobScoring", () => ({ scoreStage2: mocks.scoreStage2 }));

import { enqueueExtensionReviewAiRetry, processPendingReviewAi } from "@/server/services/candidateReviewAiService";

const NOW = Date.parse("2026-11-04T06:00:00.000Z");
const reviewId = "11111111-1111-4111-8111-111111111111";
const secondReviewId = "11111111-1111-4111-8111-111111111112";
const thirdReviewId = "11111111-1111-4111-8111-111111111113";
const candidateId = "22222222-2222-4222-8222-222222222222";
const jobId = "33333333-3333-4333-8333-333333333333";
const resumeId = "44444444-4444-4444-8444-444444444444";
const description = "Engineering responsibilities supported by the selected resume. ".repeat(10);

function review(overrides: Record<string, unknown> = {}) {
  return {
    id: reviewId, source: "extension", candidate_id: candidateId, job_id: jobId,
    base_resume_id: resumeId, ats_score: 42, hard_gates: ["Confirm clearance eligibility"],
    status: "pending", ai_status: "pending",
    ai_execution: { attempts: 1, leaseToken: "fixture-token", leaseUntil: new Date(NOW + 120_000).toISOString() },
    ...overrides,
  };
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    job_id: jobId, title: "Engineer", company: "Fixture company", location: "Remote",
    seniority_level: null, description_text: description, raw_description: null,
    requires_citizenship: false, citizenship_countries: null,
    export_control_restricted: false, eligibility_restriction_evidence: null,
    ...overrides,
  };
}

function candidate() {
  return {
    id: candidateId, name: "Fixture candidate", work_authorization: null, visa_status: null,
    preferred_locations: null, priority: "default", preferences: {}, custom_requirements: "",
  };
}

function resume(overrides: Record<string, unknown> = {}) {
  return {
    id: resumeId, candidate_id: candidateId, name: "Selected resume", target_industry: null,
    target_roles: ["Engineer"], content: "Supported engineering evidence", status: "approved",
    ...overrides,
  };
}

function scored(overrides: Record<string, unknown> = {}) {
  return {
    status: "scored", tier: "adjacent", score: 72, reason: "Supported engineering experience",
    hardGates: ["Confirm clearance eligibility", "Confirm years of experience"],
    provider: "opencode", model: "fixture-model", inputTokens: 120, outputTokens: 35,
    ...overrides,
  };
}

type QueryCall = [sql: string, values: unknown[]];
type ClaimFixture = ReturnType<typeof review> | null;

const isClaim = (sql: string) => sql.includes("WHERE q.id=(SELECT id");
const isFinish = (sql: string) => sql.includes("ai_status=$3");
const normalized = (sql: string) => sql.replace(/\s+/g, " ").trim();
const queryCalls = () => mocks.queryOne.mock.calls as QueryCall[];
const claimCalls = () => queryCalls().filter(([sql]) => isClaim(sql));
const finishCalls = () => queryCalls().filter(([sql]) => isFinish(sql));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

// Explicit result fixtures model the database boundary, not a SQL engine. SQL
// assertions below check the required locking/fencing predicates separately;
// actual PostgreSQL concurrency belongs in the integration suite.
function databaseFixtures(options: {
  claims?: readonly (ClaimFixture | Promise<ClaimFixture>)[];
  job?: ReturnType<typeof job> | null;
  candidate?: ReturnType<typeof candidate> | null;
  resume?: ReturnType<typeof resume> | null;
  config?: { custom_prompt: string; ai_match_threshold: number } | null;
  completion?: { id: string } | null | ((sql: string, values: unknown[]) => { id: string } | null);
} = {}) {
  const claims = [...(options.claims ?? [review(), null])];
  mocks.queryOne.mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (isClaim(sql)) {
      const row = await (claims.shift() ?? null);
      // RETURNING exposes the same freshly generated token that SQL stored.
      return row && { ...row, ai_execution: { ...row.ai_execution, leaseToken: values[0] } };
    }
    if (isFinish(sql)) {
      if (typeof options.completion === "function") return options.completion(sql, values);
      return options.completion === undefined ? { id: values[0] } : options.completion;
    }
    if (sql.includes("FROM jobs WHERE id=$1")) return options.job === undefined ? job() : options.job;
    if (sql.includes("FROM candidates c LEFT JOIN")) return options.candidate === undefined ? candidate() : options.candidate;
    if (sql.includes("FROM base_resumes WHERE id=$1")) return options.resume === undefined ? resume() : options.resume;
    if (sql.includes("FROM scheduled_candidate_logging_config")) {
      return options.config === undefined ? { custom_prompt: "Use recorded evidence", ai_match_threshold: 30 } : options.config;
    }
    throw new Error(`Unexpected database call in review AI test: ${sql}`);
  });
}

function expectCompletionFence(sql: string) {
  expect(normalized(sql)).toContain("WHERE q.id=$1 AND q.source='extension' AND q.status='pending' AND q.ai_status='pending'");
  expect(sql).toContain("q.ai_execution->>'leaseToken'=$2");
  expect(sql).toMatch(/\(q\.ai_execution->>'leaseUntil'\)::timestamptz\s*>\s*NOW\(\)/);
  expect(sql).toContain("RETURNING q.id");
  expect(sql).not.toMatch(/\b(?:SET|,)\s*status\s*=/i);
}

describe("candidateReviewAiService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    mocks.fetch.mockImplementation(() => { throw new Error("Network access is forbidden in review AI unit tests"); });
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.scoreStage2.mockResolvedValue(scored());
    databaseFixtures();
  });

  afterEach(() => {
    expect(mocks.fetch).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("claims only due, unleased extension reviews with an atomic SKIP LOCKED update", async () => {
    databaseFixtures({ claims: [null, null] });

    await expect(processPendingReviewAi({ ids: [reviewId] })).resolves.toEqual({ processed: 0 });

    expect(queryCalls()).toHaveLength(2);
    const tokens = claimCalls().map(([sql, values]) => {
      expect(normalized(sql)).toContain("UPDATE candidate_job_review_queue q");
      expect(normalized(sql)).toContain("WHERE source='extension' AND status='pending' AND ai_status='pending'");
      expect(normalized(sql)).toContain("ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1");
      expect(sql).toContain("COALESCE((q.ai_execution->>'attempts')::int,0)+1");
      expect(sql).toMatch(/\(ai_execution->>'leaseUntil'\)::timestamptz,'-infinity'::timestamptz\)\s*<=\s*NOW\(\)/);
      expect(sql).toMatch(/\(ai_execution->>'nextAttemptAt'\)::timestamptz,'-infinity'::timestamptz\)\s*<=\s*NOW\(\)/);
      expect(sql).toContain("($3::uuid[] IS NULL OR id=ANY($3::uuid[]))");
      expect(sql).toContain("RETURNING q.*");
      expect(values).toEqual([expect.stringMatching(/^[0-9a-f-]{36}$/i), 120, [reviewId]]);
      return values[0];
    });
    expect(new Set(tokens).size).toBe(2);
    expect(mocks.scoreStage2).not.toHaveBeenCalled();
  });

  it("starts two claims concurrently and runs at most two checks even with more work available", async () => {
    const firstClaim = deferred<ClaimFixture>();
    const scoring = deferred<ReturnType<typeof scored>>();
    databaseFixtures({ claims: [firstClaim.promise, review({ id: secondReviewId }), review({ id: thirdReviewId })] });
    mocks.scoreStage2.mockReturnValue(scoring.promise);

    const running = processPendingReviewAi({ budgetMs: 25_000 });
    await vi.waitFor(() => expect(claimCalls()).toHaveLength(2));
    expect(mocks.scoreStage2).not.toHaveBeenCalled();

    firstClaim.resolve(review());
    await vi.waitFor(() => expect(mocks.scoreStage2).toHaveBeenCalledTimes(2));
    expect(finishCalls()).toHaveLength(0);
    expect(claimCalls()).toHaveLength(2);
    expect(claimCalls().map(([, values]) => values[2])).toEqual([null, null]);
    for (const [input] of mocks.scoreStage2.mock.calls) {
      expect(input.reviewExecution).toEqual({ deadlineAt: NOW + 23_000 });
    }

    scoring.resolve(scored());
    await expect(running).resolves.toEqual({ processed: 2 });
    expect(finishCalls().map(([, values]) => values[0]).sort()).toEqual([reviewId, secondReviewId].sort());
  });

  it.each([1, 2, 3])("persists a successful attempt %i with its claimed token and preserves ATS warnings", async (attempts) => {
    databaseFixtures({ claims: [review({ ai_execution: { attempts, leaseToken: "old" } }), null] });

    await expect(processPendingReviewAi({ ids: [reviewId] })).resolves.toEqual({ processed: 1 });

    expect(mocks.scoreStage2).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      customPrompt: "Use recorded evidence", deterministicScore: 42, crossCheckFloor: 30,
      candidate: expect.objectContaining({ id: candidateId }), resume: expect.objectContaining({ id: resumeId }),
      job: expect.objectContaining({ job_id: jobId, freshnessReferenceDate: null }),
      reviewExecution: { deadlineAt: NOW + 23_000 },
    }));
    expect(finishCalls()).toHaveLength(1);
    const [sql, values] = finishCalls()[0];
    expectCompletionFence(sql);
    expect(values).toEqual([
      reviewId, claimCalls()[0][1][0], "scored", "adjacent", 72, "Supported engineering experience", null,
      JSON.stringify(["Confirm clearance eligibility", "Confirm years of experience"]),
      0, "opencode", "fixture-model", 0,
    ]);
    expect(sql).toContain("q.ai_execution-'leaseToken'-'leaseUntil'");
    expect(normalized(sql)).toContain("ELSE NULL END");
  });

  it.each([1, 2])("keeps transient attempt %i pending with a durable backoff", async (attempts) => {
    databaseFixtures({ claims: [review({ ai_execution: { attempts, leaseToken: "old" } }), null] });
    mocks.scoreStage2.mockResolvedValue({ status: "failed", failureReason: "All healthy keys are cooling", provider: "opencode", model: "fixture-model" });

    await processPendingReviewAi();

    const [sql, values] = finishCalls()[0];
    expectCompletionFence(sql);
    expect(values[2]).toBe("pending");
    expect(values.slice(3, 7)).toEqual([null, null, null, "All healthy keys are cooling"]);
    expect(values[7]).toBe(JSON.stringify(["Confirm clearance eligibility"]));
    expect(values[11]).toBe(60 * attempts);
    expect(normalized(sql)).toContain("'nextAttemptAt',CASE WHEN $3::text='pending' THEN NOW()+make_interval(secs=>$12)");
    expect(sql).not.toMatch(/'attempts'\s*,\s*0/);
    expect(finishCalls()).toHaveLength(1);
  });

  it("marks the third failed scoring attempt terminal without scheduling another automatic retry", async () => {
    databaseFixtures({ claims: [review({ ai_execution: { attempts: 3, leaseToken: "old" } }), null] });
    mocks.scoreStage2.mockResolvedValue({ status: "failed", failureReason: "Provider unavailable", provider: "opencode", model: "fixture-model" });

    await processPendingReviewAi();

    expect(finishCalls()).toHaveLength(1);
    expect(finishCalls()[0][1][2]).toBe("failed");
    expect(finishCalls()[0][1][6]).toBe("Provider unavailable");
    expect(finishCalls()[0][1][11]).toBe(0);
  });

  it("terminalizes an expired claim beyond the attempt limit without another paid check", async () => {
    databaseFixtures({ claims: [review({ ai_execution: { attempts: 4, leaseToken: "recovered" } }), null] });

    await expect(processPendingReviewAi()).resolves.toEqual({ processed: 1 });

    expect(mocks.scoreStage2).not.toHaveBeenCalled();
    expect(queryCalls()).toHaveLength(3);
    const [sql, values] = finishCalls()[0];
    expectCompletionFence(sql);
    expect(values[2]).toBe("failed");
    expect(values[6]).toMatch(/interrupted repeatedly/i);
    expect(values[11]).toBe(0);
  });

  it.each([1, 3])("checkpoints a thrown scoring error on attempt %i through the same fence", async (attempts) => {
    databaseFixtures({ claims: [review({ ai_execution: { attempts, leaseToken: "old" } }), null] });
    mocks.scoreStage2.mockRejectedValue(new Error("Temporary connection error"));

    await expect(processPendingReviewAi()).resolves.toEqual({ processed: 1 });

    const [sql, values] = finishCalls()[0];
    expectCompletionFence(sql);
    expect(values[2]).toBe(attempts === 3 ? "failed" : "pending");
    expect(values[6]).toBe("Temporary connection error");
    expect(values[11]).toBe(attempts === 3 ? 0 : 60);
  });

  it.each(["expired lease", "newer lease token", "approved review", "rejected review"])(
    "accepts a zero-row CAS after %s without an unfenced fallback write", async (ownershipLoss) => {
      const scoring = deferred<ReturnType<typeof scored>>();
      const persisted = { status: "pending", ai_status: "pending", leaseToken: "", leaseUntil: NOW + 120_000 };
      const completion = vi.fn((sql: string, values: unknown[]) => {
        expectCompletionFence(sql);
        // Model the database's zero-row CAS response after an external change.
        // SQL predicates themselves are asserted, rather than interpreted here.
        if (persisted.status !== "pending" || persisted.ai_status !== "pending"
          || persisted.leaseToken !== values[1] || persisted.leaseUntil <= NOW) return null;
        persisted.ai_status = values[2] as string;
        return { id: reviewId };
      });
      databaseFixtures({ completion });
      mocks.scoreStage2.mockReturnValue(scoring.promise);

      const running = processPendingReviewAi({ ids: [reviewId] });
      await vi.waitFor(() => expect(mocks.scoreStage2).toHaveBeenCalledOnce());
      persisted.leaseToken = claimCalls()[0][1][0] as string;
      if (ownershipLoss === "expired lease") persisted.leaseUntil = NOW - 1;
      if (ownershipLoss === "newer lease token") persisted.leaseToken = "replacement-worker-token";
      if (ownershipLoss === "approved review") persisted.status = "approved";
      if (ownershipLoss === "rejected review") persisted.status = "rejected";
      const protectedState = { ...persisted };
      scoring.resolve(scored());
      await expect(running).resolves.toEqual({ processed: 1 });

      expect(completion).toHaveBeenCalledOnce();
      expect(completion.mock.results[0].value).toBeNull();
      expect(persisted).toEqual(protectedState);
      expect(finishCalls()).toHaveLength(1);
      expectCompletionFence(finishCalls()[0][0]);
      expect(finishCalls()[0][1][1]).toBe(claimCalls()[0][1][0]);
      expect(mocks.scoreStage2).toHaveBeenCalledOnce();
      expect(queryCalls()).toHaveLength(7);
    },
  );

  it("does not duplicate scoring when an overlapping worker loses the database claim", async () => {
    const scoring = deferred<ReturnType<typeof scored>>();
    databaseFixtures({ claims: [review(), null, null, null] });
    mocks.scoreStage2.mockReturnValue(scoring.promise);

    const winner = processPendingReviewAi({ ids: [reviewId] });
    await vi.waitFor(() => expect(mocks.scoreStage2).toHaveBeenCalledOnce());
    await expect(processPendingReviewAi({ ids: [reviewId] })).resolves.toEqual({ processed: 0 });
    expect(claimCalls()).toHaveLength(4);
    expect(new Set(claimCalls().map(([, values]) => values[0])).size).toBe(4);
    expect(mocks.scoreStage2).toHaveBeenCalledOnce();

    scoring.resolve(scored());
    await expect(winner).resolves.toEqual({ processed: 1 });
    expect(finishCalls()).toHaveLength(1);
  });

  it.each([
    ["missing job", { job: null }],
    ["missing candidate", { candidate: null }],
    ["missing resume", { resume: null }],
    ["resume belonging to another candidate", { resume: resume({ candidate_id: "other-candidate" }) }],
    ["archived resume", { resume: resume({ status: "archived" }) }],
    ["missing selected resume ID", { claims: [review({ base_resume_id: null }), null], resume: null }],
    ["empty description", { job: job({ description_text: "" }) }],
    ["short description", { job: job({ description_text: "x".repeat(249) }) }],
  ] as const)("fails %s safely without paid AI or downstream application writes", async (_label, fixtures) => {
    databaseFixtures(fixtures);

    await expect(processPendingReviewAi()).resolves.toEqual({ processed: 1 });

    expect(mocks.scoreStage2).not.toHaveBeenCalled();
    expect(finishCalls()).toHaveLength(1);
    const [sql, values] = finishCalls()[0];
    expectCompletionFence(sql);
    expect(values[2]).toBe("failed");
    expect(values[6]).toMatch(/no longer available|too short/i);
    expect(values[7]).toBe(JSON.stringify(["Confirm clearance eligibility"]));
    for (const [statement] of queryCalls()) {
      if (/^\s*(?:UPDATE|INSERT|DELETE)/i.test(statement)) {
        expect(statement).toMatch(/^\s*UPDATE candidate_job_review_queue\b/);
      }
      expect(statement).not.toMatch(/\b(?:INSERT INTO|UPDATE)\s+(?:applications|application_ai_workflows|scheduled_candidate_logging_\w+)\b/i);
    }
  });

  it("uses the raw description and safe defaults when optional config or ATS data is absent", async () => {
    databaseFixtures({
      claims: [review({ ats_score: null }), null],
      job: job({ description_text: null, raw_description: description }), config: null,
    });

    await processPendingReviewAi();

    expect(mocks.scoreStage2).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      description, customPrompt: "", deterministicScore: 0, crossCheckFloor: undefined,
    }));
    expect(finishCalls()[0][1][2]).toBe("scored");
  });

  it("records an AI rejection as evidence while preserving the independent human decision", async () => {
    mocks.scoreStage2.mockResolvedValue(scored({ tier: "reject", score: 5, reason: "Wrong domain", hardGates: [] }));

    await processPendingReviewAi();

    const [sql, values] = finishCalls()[0];
    expectCompletionFence(sql);
    expect(values.slice(2, 6)).toEqual(["scored", null, 5, "AI assessment: not recommended. Wrong domain"]);
    expect(JSON.parse(values[7] as string)).toEqual([
      "Confirm clearance eligibility", "AI did not recommend this pairing; a human reviewer must decide.",
    ]);
  });

  describe("enqueueExtensionReviewAiRetry", () => {
    it("resets a retryable extension review and treats a second same-ID request as already queued", async () => {
      mocks.queryOne.mockReset()
        .mockResolvedValueOnce({ id: reviewId })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ status: "pending", ai_status: "pending", base_resume_id: resumeId });

      await expect(enqueueExtensionReviewAiRetry(reviewId)).resolves.toBeUndefined();
      await expect(enqueueExtensionReviewAiRetry(reviewId)).resolves.toBeUndefined();

      expect(queryCalls()).toHaveLength(3);
      for (const [sql, values] of queryCalls().slice(0, 2)) {
        expect(values).toEqual([reviewId]);
        expect(normalized(sql)).toContain("WHERE id=$1 AND source='extension' AND status='pending' AND base_resume_id IS NOT NULL AND ai_status<>'pending'");
        expect(sql).toContain("ai_execution='{}'::jsonb");
        expect(normalized(sql)).toContain("ai_score=NULL,ai_reason=NULL,ai_failure_reason=NULL");
        expect(sql).toContain("ai_tier=NULL");
        expect(sql).not.toMatch(/\bhard_gates\s*=/);
      }
      expect(queryCalls()[2][0]).toContain("WHERE id=$1 AND source='extension'");
      expect(mocks.scoreStage2).not.toHaveBeenCalled();
    });

    it("leaves an active pending lease and its attempt count untouched", async () => {
      const active = review({ ai_execution: { attempts: 2, leaseToken: "active-owner", leaseUntil: new Date(NOW + 120_000).toISOString() } });
      mocks.queryOne.mockReset().mockResolvedValueOnce(null).mockResolvedValueOnce(active);

      await expect(enqueueExtensionReviewAiRetry(reviewId)).resolves.toBeUndefined();

      expect(queryCalls()).toHaveLength(2);
      expect(queryCalls()[0][0]).toContain("AND ai_status<>'pending'");
      expect(active.ai_execution).toEqual({ attempts: 2, leaseToken: "active-owner", leaseUntil: new Date(NOW + 120_000).toISOString() });
      expect(mocks.scoreStage2).not.toHaveBeenCalled();
    });

    it.each([
      ["missing or scheduled-source review", null],
      ["approved review", { status: "approved", ai_status: "failed", base_resume_id: resumeId }],
      ["rejected review", { status: "rejected", ai_status: "failed", base_resume_id: resumeId }],
      ["review without a resume", { status: "pending", ai_status: "failed", base_resume_id: null }],
    ] as const)("refuses a %s without an unguarded reset", async (_label, existing) => {
      mocks.queryOne.mockReset().mockResolvedValueOnce(null).mockResolvedValueOnce(existing);

      await expect(enqueueExtensionReviewAiRetry(reviewId)).rejects.toThrow(/Only a pending extension review/);

      expect(queryCalls()).toHaveLength(2);
      expect(queryCalls()[0][0]).toContain("source='extension' AND status='pending' AND base_resume_id IS NOT NULL");
      expect(queryCalls()[1][0]).toContain("WHERE id=$1 AND source='extension'");
      expect(mocks.scoreStage2).not.toHaveBeenCalled();
    });
  });
});
