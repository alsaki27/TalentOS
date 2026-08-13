// Regression guard for the easiest bug to introduce in the whole
// email-intelligence plan (Chunk C): a status_change_approval proposal MUST
// be created with resolution_rule='manual_only'. storeRawMessage's
// thread-reply sweep auto-closes any open item with
// resolution_rule='manual_or_thread_reply' whose source email shares a
// thread with a later outbound message - a proposal using that rule would
// be silently discarded the moment anyone replied in-thread, deleting a
// pending human decision with no trace.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db/neon", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@/server/repositories/gmailIntegrationRepository", () => ({
  listActiveCandidateGmailAccounts: vi.fn(),
  getDecryptedGmailAccount: vi.fn(),
  saveEncryptedGmailTokens: vi.fn(),
  markGmailAccountError: vi.fn(),
  updateGmailHistoryId: vi.fn(),
  updateGmailBackfillState: vi.fn(),
}));

vi.mock("@/lib/integrations/gmailApi", () => ({
  refreshGmailAccessToken: vi.fn(),
  listMessageIds: vi.fn(),
  listHistory: vi.fn(),
  getMessage: vi.fn(),
  getProfile: vi.fn(),
  modifyMessage: vi.fn().mockResolvedValue(undefined),
  ensureUserLabel: vi.fn().mockResolvedValue("label-1"),
}));

vi.mock("@/lib/ai/emailInterviewExtraction", () => ({
  extractInterviewDetails: vi.fn(),
}));

vi.mock("@/server/services/applicationStatusService", async () => {
  const actual = await vi.importActual<typeof import("@/server/services/applicationStatusService")>(
    "@/server/services/applicationStatusService",
  );
  return {
    ...actual,
    changeApplicationStatus: vi.fn(),
  };
});

vi.mock("@/lib/ai/emailTriage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/emailTriage")>("@/lib/ai/emailTriage");
  return {
    ...actual,
    triageEmail: vi.fn(),
  };
});

import { query, queryOne, execute } from "@/server/db/neon";
import { triageEmail } from "@/lib/ai/emailTriage";
import { changeApplicationStatus } from "@/server/services/applicationStatusService";
import { triageStoredMessage } from "@/server/services/gmailSyncService";
import type { EmailTriagePolicy } from "@/server/services/emailApprovalPolicy";

// Explicit policyOverride (rather than relying on loadEmailTriagePolicy's
// unmocked "config row missing" fallback, which happens to be risk_based/
// 0.85 too) - this is exactly what the override parameter exists for: the
// same 0.85 threshold Chunk D's fallback default happens to use, but stated
// here so the test's intent doesn't depend on that coincidence.
const RISK_BASED_POLICY: EmailTriagePolicy = { policy: "risk_based", threshold: 0.85, isActive: true, loadedFrom: "config" };

describe("triageStoredMessage — status_change_approval proposal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (execute as any).mockResolvedValue({ rowCount: 1 });
  });

  it("creates the proposal with resolution_rule='manual_only', not 'manual_or_thread_reply'", async () => {
    // Row fetch inside triageStoredMessage.
    (queryOne as any).mockResolvedValueOnce({
      id: "email-1", candidate_id: "cand-1", subject: "Update on your application",
      snippet: "We regret to inform you", body_text: "We regret to inform you we will not be moving forward.",
      from_email: "recruiter@acmecorp.com", direction: "inbound", gmail_message_id: "gm-1",
    });
    // getCandidateApplicationContext's query.
    (query as any).mockResolvedValueOnce([{ id: "app-1", title: "Backend Engineer", company: "Acme Corp", status: "interview" }]);

    // Below the auto-write confidence threshold (0.85), so canAutoWrite is
    // false and this must fall into the proposal path instead of
    // changeApplicationStatus - "rejection" is otherwise an
    // AUTO_WRITE_CATEGORIES member, which is exactly what makes 0.6 here a
    // meaningful test of the confidence gate, not just the category gate.
    (triageEmail as any).mockResolvedValue({
      relevant: true, category: "rejection", confidence: 0.6,
      matchedApplicationId: "app-1", suggestedStatus: null, needsReply: false,
      summary: "Rejection email detected.",
    });

    await triageStoredMessage("email-1", "fake-access-token", RISK_BASED_POLICY);

    expect(changeApplicationStatus).not.toHaveBeenCalled();

    const calls = (execute as any).mock.calls as [string, unknown[]][];
    const proposalCall = calls.find(([sql]) => sql.includes("status_change_approval"));
    expect(proposalCall).toBeDefined();

    const [sql, params] = proposalCall!;
    expect(sql).toContain("'manual_only'");
    expect(sql).not.toContain("manual_or_thread_reply");
    expect(params).toEqual(expect.arrayContaining(["rejected", "interview", 0.6]));
  });

  it("does not create a proposal when canAutoWrite succeeds (site 4 handles it instead)", async () => {
    (queryOne as any).mockResolvedValueOnce({
      id: "email-2", candidate_id: "cand-1", subject: "Interview invitation",
      snippet: "Let's schedule your interview", body_text: "We would like to schedule an interview.",
      from_email: "recruiter@acmecorp.com", direction: "inbound", gmail_message_id: "gm-2",
    });
    (query as any).mockResolvedValueOnce([{ id: "app-1", title: "Backend Engineer", company: "Acme Corp", status: "applied" }]);
    (triageEmail as any).mockResolvedValue({
      relevant: true, category: "interview_invite", confidence: 0.95,
      matchedApplicationId: "app-1", suggestedStatus: null, needsReply: false,
      summary: "Interview invite detected.",
    });
    (changeApplicationStatus as any).mockResolvedValue({ changed: true, fromStatus: "applied", toStatus: "interview" });

    await triageStoredMessage("email-2", "fake-access-token", RISK_BASED_POLICY);

    expect(changeApplicationStatus).toHaveBeenCalledWith(expect.objectContaining({
      applicationId: "app-1", toStatus: "interview", actorType: "ai", source: "email_ai",
    }));
    const calls = (execute as any).mock.calls as [string, unknown[]][];
    expect(calls.some(([sql]) => sql.includes("status_change_approval"))).toBe(false);
    const fyiCall = calls.find(([sql]) => sql.includes("status_change_review"));
    expect(fyiCall![0]).toContain("'auto_approved'");
  });

  it("always_human policy proposes instead of auto-writing, even at confidence that would clear the risk_based threshold", async () => {
    (queryOne as any).mockResolvedValueOnce({
      id: "email-3", candidate_id: "cand-1", subject: "You're hired!",
      snippet: "We are pleased to offer you the position", body_text: "We are pleased to offer you the position.",
      from_email: "recruiter@acmecorp.com", direction: "inbound", gmail_message_id: "gm-3",
    });
    (query as any).mockResolvedValueOnce([{ id: "app-1", title: "Backend Engineer", company: "Acme Corp", status: "interview" }]);
    (triageEmail as any).mockResolvedValue({
      relevant: true, category: "offer", confidence: 0.99,
      matchedApplicationId: "app-1", suggestedStatus: null, needsReply: false,
      summary: "Offer detected.",
    });

    const alwaysHuman: EmailTriagePolicy = { policy: "always_human", threshold: 0.85, isActive: true, loadedFrom: "config" };
    await triageStoredMessage("email-3", "fake-access-token", alwaysHuman);

    expect(changeApplicationStatus).not.toHaveBeenCalled();
    const calls = (execute as any).mock.calls as [string, unknown[]][];
    const proposalCall = calls.find(([sql]) => sql.includes("status_change_approval"));
    expect(proposalCall).toBeDefined();
    expect(proposalCall![1]).toEqual(expect.arrayContaining(["always_human"]));
  });

  it("auto policy auto-writes even below the risk_based confidence threshold - this is the goal-#4 acceptance path: config only, no code change", async () => {
    (queryOne as any).mockResolvedValueOnce({
      id: "email-4", candidate_id: "cand-1", subject: "Application status",
      snippet: "We will not be moving forward", body_text: "We will not be moving forward with your application.",
      from_email: "recruiter@acmecorp.com", direction: "inbound", gmail_message_id: "gm-4",
    });
    (query as any).mockResolvedValueOnce([{ id: "app-1", title: "Backend Engineer", company: "Acme Corp", status: "interview" }]);
    (triageEmail as any).mockResolvedValue({
      relevant: true, category: "rejection", confidence: 0.3,
      matchedApplicationId: "app-1", suggestedStatus: null, needsReply: false,
      summary: "Rejection detected.",
    });
    (changeApplicationStatus as any).mockResolvedValue({ changed: true, fromStatus: "interview", toStatus: "rejected" });

    const autoPolicy: EmailTriagePolicy = { policy: "auto", threshold: 0.85, isActive: true, loadedFrom: "config" };
    await triageStoredMessage("email-4", "fake-access-token", autoPolicy);

    expect(changeApplicationStatus).toHaveBeenCalledWith(expect.objectContaining({ toStatus: "rejected", confidence: 0.3 }));
    const calls = (execute as any).mock.calls as [string, unknown[]][];
    expect(calls.some(([sql]) => sql.includes("status_change_approval"))).toBe(false);
  });

  it("fails closed: a disabled agent proposes instead of auto-writing, even under the auto policy", async () => {
    (queryOne as any).mockResolvedValueOnce({
      id: "email-5", candidate_id: "cand-1", subject: "You're hired!",
      snippet: "We are pleased to offer you the position", body_text: "We are pleased to offer you the position.",
      from_email: "recruiter@acmecorp.com", direction: "inbound", gmail_message_id: "gm-5",
    });
    (query as any).mockResolvedValueOnce([{ id: "app-1", title: "Backend Engineer", company: "Acme Corp", status: "interview" }]);
    (triageEmail as any).mockResolvedValue({
      relevant: true, category: "offer", confidence: 0.99,
      matchedApplicationId: "app-1", suggestedStatus: null, needsReply: false,
      summary: "Offer detected.",
    });

    const inactiveAuto: EmailTriagePolicy = { policy: "auto", threshold: 0.85, isActive: false, loadedFrom: "config" };
    await triageStoredMessage("email-5", "fake-access-token", inactiveAuto);

    expect(changeApplicationStatus).not.toHaveBeenCalled();
    const calls = (execute as any).mock.calls as [string, unknown[]][];
    expect(calls.some(([sql]) => sql.includes("status_change_approval"))).toBe(true);
  });
});

describe("triageStoredMessage — storeButHide skips AI and records suppression_reason/suppression_rule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (execute as any).mockResolvedValue({ rowCount: 1 });
  });

  // classifyGmailMessage is NOT mocked in this file, so this exercises the
  // real function against a message shaped like the storeButHide tier
  // (job-board domain, alert-shaped subject, but not the narrow
  // pre-storage-drop shape) - this is the reachable branch in
  // triageStoredMessage's live callgraph, since runGmailSync already
  // filters classifyGmailMessage(msg).suppress===true before storage.
  it("skips triageEmail entirely and writes suppression_reason/suppression_rule instead of ai_summary prose", async () => {
    (queryOne as any).mockResolvedValueOnce({
      id: "email-6", candidate_id: "cand-1", subject: "5 new jobs near you",
      snippet: null, body_text: "Check out these jobs.",
      from_email: "someuser@indeed.com", direction: "inbound", gmail_message_id: "gm-6",
    });
    (query as any).mockResolvedValueOnce([{ id: "app-1", title: "Backend Engineer", company: "Acme Corp", status: "applied" }]);

    await triageStoredMessage("email-6", "fake-access-token", RISK_BASED_POLICY);

    expect(triageEmail).not.toHaveBeenCalled();
    expect(changeApplicationStatus).not.toHaveBeenCalled();

    const calls = (execute as any).mock.calls as [string, unknown[]][];
    const suppressCall = calls.find(([sql]) => sql.includes("suppression_reason"));
    expect(suppressCall).toBeDefined();
    const [sql, params] = suppressCall!;
    expect(sql).toContain("ai_relevant = false");
    expect(params).toEqual(expect.arrayContaining(["job_board_alert", "job_board:alert_subject"]));
  });
});
