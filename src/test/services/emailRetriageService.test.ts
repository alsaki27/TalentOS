// Chunk H — deterministic backfill/re-triage. classifyGmailMessage is
// mocked per-row so these tests exercise retriageEmailBacklog's own
// bucketing/write logic in isolation from gmailSuppression's regex rules
// (those have their own coverage in gmailSuppression.test.ts).
//
// query() call order per invocation, mocked via mockResolvedValueOnce in
// the same sequence every test must match:
//   1. the page SELECT
//   2. (apply only, suppressIds.length>0) action_items RETURNING for suppressed emails
//   3. (apply only, needsReplyClearIds.length>0) action_items RETURNING for needs-reply-cleared emails
//   4. the remaining-count SELECT (always last)

import { describe, it, expect, vi, beforeEach } from "vitest";

const DEFAULT_LIMIT = 500;

vi.mock("@/server/db/neon", () => ({
  query: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@/lib/integrations/gmailSuppression", () => ({
  classifyGmailMessage: vi.fn(),
}));

vi.mock("@/lib/activity", () => ({
  logActivity: vi.fn(),
}));

import { query, execute } from "@/server/db/neon";
import { classifyGmailMessage } from "@/lib/integrations/gmailSuppression";
import { logActivity } from "@/lib/activity";
import { retriageEmailBacklog } from "@/server/services/emailRetriageService";

const mockQuery = query as unknown as ReturnType<typeof vi.fn>;
const mockExecute = execute as unknown as ReturnType<typeof vi.fn>;
const mockClassify = classifyGmailMessage as unknown as ReturnType<typeof vi.fn>;

const NEUTRAL_VERDICT = {
  suppress: false, storeButHide: false, reason: null, senderClass: "human" as const,
  forceNeedsReplyFalse: false, rule: "none",
};

function row(overrides: Partial<{
  id: string; candidate_id: string; from_email: string | null; subject: string | null;
  snippet: string | null; body_text: string | null; ai_relevant: boolean | null; needs_reply: boolean;
}> = {}) {
  return {
    id: "email-1", candidate_id: "cand-1", from_email: "noreply@indeed.com", subject: "Job alert",
    snippet: null, body_text: null, ai_relevant: true, needs_reply: true,
    ...overrides,
  };
}

function primePage(pageRows: unknown[]) {
  mockQuery.mockResolvedValueOnce(pageRows);
}

function primeRemaining(n: number) {
  mockQuery.mockResolvedValueOnce([{ n }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockResolvedValue({ rowCount: 1 });
});

describe("retriageEmailBacklog — bucket classification", () => {
  it("buckets a fresh job-board-alert row as suppressed, not needs-reply-cleared", async () => {
    primePage([row({ id: "e1", ai_relevant: true, needs_reply: true })]);
    mockClassify.mockReturnValue({ ...NEUTRAL_VERDICT, suppress: true, reason: "job_board_alert", forceNeedsReplyFalse: true, rule: "job_board:alert_local" });
    primeRemaining(0);

    const report = await retriageEmailBacklog({ dryRun: true, batchId: "batch-1" });

    expect(report.emailsSuppressed).toBe(1);
    expect(report.emailsNeedsReplyCleared).toBe(0);
    expect(report.samples).toEqual([expect.objectContaining({ emailId: "e1", effect: "suppressed", rule: "job_board:alert_local" })]);
  });

  it("buckets a storeButHide row as suppressed too - same recoverable-hide treatment as a hard suppress", async () => {
    primePage([row({ id: "e2" })]);
    mockClassify.mockReturnValue({ ...NEUTRAL_VERDICT, storeButHide: true, reason: "job_board_alert", forceNeedsReplyFalse: true, rule: "job_board:alert_subject" });
    primeRemaining(0);

    const report = await retriageEmailBacklog({ dryRun: true, batchId: "batch-1" });

    expect(report.emailsSuppressed).toBe(1);
  });

  it("buckets forceNeedsReplyFalse-only as needs-reply-cleared when the row currently needs a reply", async () => {
    primePage([row({ id: "e3", needs_reply: true })]);
    mockClassify.mockReturnValue({ ...NEUTRAL_VERDICT, forceNeedsReplyFalse: true, rule: "rescue:human_relay_local" });
    primeRemaining(0);

    const report = await retriageEmailBacklog({ dryRun: true, batchId: "batch-1" });

    expect(report.emailsSuppressed).toBe(0);
    expect(report.emailsNeedsReplyCleared).toBe(1);
    expect(report.samples[0].effect).toBe("needs_reply_cleared");
  });

  it("leaves a row unchanged when it already reflects the new rules (already ai_relevant=false, needs_reply=false)", async () => {
    primePage([row({ id: "e4", ai_relevant: false, needs_reply: false })]);
    mockClassify.mockReturnValue({ ...NEUTRAL_VERDICT, suppress: true, reason: "job_board_alert", forceNeedsReplyFalse: true, rule: "job_board:alert_local" });
    primeRemaining(0);

    const report = await retriageEmailBacklog({ dryRun: true, batchId: "batch-1" });

    // ai_relevant is already false, so this doesn't re-count as a fresh
    // suppression; needs_reply is already false too, so it's not a
    // needs-reply-clear either - it just gets stamped as scanned.
    expect(report.emailsSuppressed).toBe(0);
    expect(report.emailsNeedsReplyCleared).toBe(0);
  });

  it("clears a stale needs_reply flag on an already-hidden row without double-suppressing it", async () => {
    primePage([row({ id: "e5", ai_relevant: false, needs_reply: true })]);
    mockClassify.mockReturnValue({ ...NEUTRAL_VERDICT, suppress: true, reason: "job_board_alert", forceNeedsReplyFalse: true, rule: "job_board:alert_local" });
    primeRemaining(0);

    const report = await retriageEmailBacklog({ dryRun: true, batchId: "batch-1" });

    expect(report.emailsSuppressed).toBe(0);
    expect(report.emailsNeedsReplyCleared).toBe(1);
  });

  it("leaves a genuinely relevant, human-sender row alone", async () => {
    primePage([row({ id: "e6", from_email: "recruiter@acmecorp.com", needs_reply: true })]);
    mockClassify.mockReturnValue(NEUTRAL_VERDICT);
    primeRemaining(0);

    const report = await retriageEmailBacklog({ dryRun: true, batchId: "batch-1" });

    expect(report.emailsSuppressed).toBe(0);
    expect(report.emailsNeedsReplyCleared).toBe(0);
    expect(report.samples).toEqual([]);
  });
});

describe("retriageEmailBacklog — dry run vs apply", () => {
  it("dry run never calls execute() - writes nothing", async () => {
    primePage([row({ id: "e1" })]);
    mockClassify.mockReturnValue({ ...NEUTRAL_VERDICT, suppress: true, reason: "job_board_alert", forceNeedsReplyFalse: true, rule: "job_board:alert_local" });
    primeRemaining(5);

    const report = await retriageEmailBacklog({ dryRun: true, batchId: "batch-1" });

    expect(mockExecute).not.toHaveBeenCalled();
    expect(report.dryRun).toBe(true);
    expect(report.remaining).toBe(5);
  });

  it("apply writes each suppression group with its own reason/rule, not a single hardcoded label", async () => {
    primePage([
      row({ id: "e1", from_email: "noreply@indeed.com" }),
      row({ id: "e2", from_email: "newsletter@deals.example.com" }),
    ]);
    mockClassify.mockImplementation((msg: { from?: string | null }) => {
      if (msg.from === "noreply@indeed.com") {
        return { ...NEUTRAL_VERDICT, suppress: true, reason: "job_board_alert", forceNeedsReplyFalse: true, rule: "job_board:alert_local" };
      }
      return { ...NEUTRAL_VERDICT, suppress: true, reason: "bulk_marketing", forceNeedsReplyFalse: true, rule: "bulk_marketing" };
    });
    mockQuery.mockResolvedValueOnce([]); // action_items RETURNING for suppressIds - nothing dismissed
    primeRemaining(0);

    await retriageEmailBacklog({ dryRun: false, batchId: "batch-1" });

    const updateCalls = mockExecute.mock.calls.filter(([sql]) => typeof sql === "string" && sql.includes("SET ai_relevant = false, needs_reply = false"));
    expect(updateCalls).toHaveLength(2);
    const reasons = updateCalls.map(([, params]) => (params as unknown[])[0]);
    const rules = updateCalls.map(([, params]) => (params as unknown[])[1]);
    expect(reasons.sort()).toEqual(["bulk_marketing", "job_board_alert"]);
    expect(rules.sort()).toEqual(["bulk_marketing", "job_board:alert_local"]);
  });

  it("apply writes the needs-reply-clear and unchanged batch-stamp UPDATEs", async () => {
    primePage([
      row({ id: "e1", from_email: "noreply@indeed.com", needs_reply: true }),
      row({ id: "e2", from_email: "recruiter@acmecorp.com", needs_reply: false }),
    ]);
    mockClassify.mockImplementation((msg: { from?: string | null }) => {
      if (msg.from === "noreply@indeed.com") return { ...NEUTRAL_VERDICT, forceNeedsReplyFalse: true, rule: "rescue:human_relay_local" };
      return NEUTRAL_VERDICT;
    });
    mockQuery.mockResolvedValueOnce([]); // action_items RETURNING for needsReplyClearIds - nothing dismissed
    primeRemaining(0);

    await retriageEmailBacklog({ dryRun: false, batchId: "batch-1" });

    const needsReplyUpdate = mockExecute.mock.calls.find(([sql]) => typeof sql === "string" && sql.includes("SET needs_reply = false, retriage_batch_id"));
    expect(needsReplyUpdate).toBeDefined();
    expect(needsReplyUpdate![1]).toEqual(["batch-1", ["e1"]]);

    const unchangedUpdate = mockExecute.mock.calls.find(([sql]) => typeof sql === "string" && sql.includes("SET retriage_batch_id = $1, retriaged_at = now() WHERE id = ANY"));
    expect(unchangedUpdate).toBeDefined();
    expect(unchangedUpdate![1]).toEqual(["batch-1", ["e2"]]);
  });
});

describe("retriageEmailBacklog — action item dismissal", () => {
  it("never dismisses a protected type (interview_followup, calendar_conflict) even on a suppressed email", async () => {
    primePage([row({ id: "e1" })]);
    mockClassify.mockReturnValue({ ...NEUTRAL_VERDICT, suppress: true, reason: "job_board_alert", forceNeedsReplyFalse: true, rule: "job_board:alert_local" });
    mockQuery.mockResolvedValueOnce([]); // action_items RETURNING - simulates the DB's own type <> ALL() filter excluding protected rows
    primeRemaining(0);

    await retriageEmailBacklog({ dryRun: false, batchId: "batch-1" });

    const dismissCall = mockQuery.mock.calls.find(([sql]) => typeof sql === "string" && sql.includes("UPDATE action_items") && sql.includes("email_communication_id"));
    expect(dismissCall).toBeDefined();
    const [, params] = dismissCall!;
    expect((params as unknown[])[2]).toEqual(["interview_followup", "calendar_conflict"]);
  });

  it("writes one candidate_workflow_events row per dismissed item, carrying candidate_id through", async () => {
    primePage([row({ id: "e1", candidate_id: "cand-9" })]);
    mockClassify.mockReturnValue({ ...NEUTRAL_VERDICT, suppress: true, reason: "job_board_alert", forceNeedsReplyFalse: true, rule: "job_board:alert_local" });
    mockQuery.mockResolvedValueOnce([{ id: "ai-1", type: "needs_reply", candidate_id: "cand-9" }]);
    primeRemaining(0);

    const report = await retriageEmailBacklog({ dryRun: false, batchId: "batch-1" });

    expect(report.actionItemsDismissed).toEqual({ total: 1, byType: { needs_reply: 1 } });
    const eventInsert = mockExecute.mock.calls.find(([sql]) => typeof sql === "string" && sql.includes("candidate_workflow_events"));
    expect(eventInsert).toBeDefined();
    expect(eventInsert![1]).toEqual(["cand-9", "ai-1", JSON.stringify({ batchId: "batch-1" })]);
    expect(logActivity).toHaveBeenCalledTimes(1);
  });

  it("logs no activity summary when nothing was dismissed", async () => {
    primePage([row({ id: "e1", from_email: "recruiter@acmecorp.com", needs_reply: true })]);
    mockClassify.mockReturnValue(NEUTRAL_VERDICT);
    primeRemaining(0);

    await retriageEmailBacklog({ dryRun: false, batchId: "batch-1" });

    expect(logActivity).not.toHaveBeenCalled();
  });
});

describe("retriageEmailBacklog — resumability", () => {
  it("pages using retriage_batch_id IS DISTINCT FROM $batchId so a re-run resumes rather than redoes", async () => {
    primePage([row({ id: "e1", from_email: "recruiter@acmecorp.com", needs_reply: true })]);
    mockClassify.mockReturnValue(NEUTRAL_VERDICT);
    primeRemaining(0);

    await retriageEmailBacklog({ dryRun: true, batchId: "batch-42" });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("retriage_batch_id IS DISTINCT FROM $1");
    expect(params).toEqual(["batch-42", DEFAULT_LIMIT]);
  });

  it("a completed batch (nothing left unstamped) returns zero scanned rows and remaining=0", async () => {
    primePage([]);
    primeRemaining(0);

    const report = await retriageEmailBacklog({ dryRun: true, batchId: "batch-42" });

    expect(report.scanned).toBe(0);
    expect(report.remaining).toBe(0);
    expect(mockClassify).not.toHaveBeenCalled();
  });

  it("reports the full unscanned total as remaining under a dry run, not just this page's leftover", async () => {
    primePage([row({ id: "e1", from_email: "recruiter@acmecorp.com", needs_reply: true })]);
    mockClassify.mockReturnValue(NEUTRAL_VERDICT);
    primeRemaining(400);

    const report = await retriageEmailBacklog({ dryRun: true, batchId: "batch-1", limit: 1 });

    expect(report.scanned).toBe(1);
    expect(report.remaining).toBe(400);
  });
});

describe("retriageEmailBacklog — policy seed", () => {
  it("does not touch ai_agent_configs unless applyPolicySeed is explicitly true", async () => {
    primePage([row({ id: "e1", from_email: "recruiter@acmecorp.com", needs_reply: true })]);
    mockClassify.mockReturnValue(NEUTRAL_VERDICT);
    primeRemaining(0);

    const report = await retriageEmailBacklog({ dryRun: false, batchId: "batch-1" });

    expect(mockExecute.mock.calls.some(([sql]) => typeof sql === "string" && sql.includes("ai_agent_configs"))).toBe(false);
    expect(report.policySeedApplied).toBe(false);
  });

  it("does not seed the policy on a dry run even if applyPolicySeed is true - dryRun wins", async () => {
    primePage([row({ id: "e1", from_email: "recruiter@acmecorp.com", needs_reply: true })]);
    mockClassify.mockReturnValue(NEUTRAL_VERDICT);
    primeRemaining(0);

    const report = await retriageEmailBacklog({ dryRun: true, batchId: "batch-1", applyPolicySeed: true });

    expect(mockExecute).not.toHaveBeenCalled();
    expect(report.policySeedApplied).toBe(false);
  });

  it("seeds ai_agent_configs to risk_based/8.5 only when apply=true and applyPolicySeed=true", async () => {
    primePage([row({ id: "e1", from_email: "recruiter@acmecorp.com", needs_reply: true })]);
    mockClassify.mockReturnValue(NEUTRAL_VERDICT);
    primeRemaining(0);

    const report = await retriageEmailBacklog({ dryRun: false, batchId: "batch-1", applyPolicySeed: true });

    const seedCall = mockExecute.mock.calls.find(([sql]) => typeof sql === "string" && sql.includes("ai_agent_configs"));
    expect(seedCall).toBeDefined();
    expect(seedCall![0]).toContain("risk_based");
    expect(seedCall![0]).toContain("8.5");
    expect(report.policySeedApplied).toBe(true);
  });
});
