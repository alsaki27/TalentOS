import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/neon", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@/server/repositories/gmailIntegrationRepository", () => ({
  listActiveCandidateGmailAccounts: vi.fn(),
  listActiveSharedGmailAccount: vi.fn(),
  getDecryptedGmailAccount: vi.fn(),
  saveEncryptedGmailTokens: vi.fn(),
  markGmailAccountError: vi.fn(),
  recordGmailAccountSyncIssue: vi.fn(),
  updateGmailHistoryId: vi.fn(),
  updateGmailBackfillState: vi.fn(),
  saveGmailWatch: vi.fn(),
}));

vi.mock("@/lib/integrations/gmailApi", () => ({
  refreshGmailAccessToken: vi.fn(),
  listMessageIds: vi.fn(),
  listHistory: vi.fn(),
  getMessage: vi.fn(),
  getProfile: vi.fn(),
  modifyMessage: vi.fn(),
  ensureUserLabel: vi.fn(),
  watchGmailMailbox: vi.fn(),
}));

vi.mock("@/server/services/candidateEmailMatcher", () => ({ matchCandidateForMessage: vi.fn() }));
vi.mock("@/lib/ai/emailTriage", () => ({ triageEmail: vi.fn(), INTERVIEW_EXTRACTION_CONFIDENCE: 0.8 }));
vi.mock("@/lib/ai/emailInterviewExtraction", () => ({ extractInterviewDetails: vi.fn() }));
vi.mock("@/lib/integrations/gmailSuppression", () => ({
  classifyGmailMessage: vi.fn(() => ({ suppress: true, storeButHide: false })),
}));
vi.mock("@/server/services/applicationStatusService", () => ({
  changeApplicationStatus: vi.fn(),
  emailStageTarget: vi.fn(),
}));
vi.mock("@/server/services/emailApprovalPolicy", () => ({
  loadEmailTriagePolicy: vi.fn(),
  decideStatusWrite: vi.fn(),
}));

import { execute, query, queryOne } from "@/server/db/neon";
import {
  getDecryptedGmailAccount,
  listActiveSharedGmailAccount,
  markGmailAccountError,
  recordGmailAccountSyncIssue,
  saveEncryptedGmailTokens,
  updateGmailBackfillState,
  updateGmailHistoryId,
} from "@/server/repositories/gmailIntegrationRepository";
import {
  getMessage,
  getProfile,
  listMessageIds,
  refreshGmailAccessToken,
} from "@/lib/integrations/gmailApi";
import { runGmailSync } from "@/server/services/gmailSyncService";

const accountRow = {
  id: "shared-gmail-1",
  candidate_id: null,
  email: "mail.skarion@gmail.com",
  scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
  access_token: "cached-access-token",
  refresh_token: "stored-refresh-token",
  token_expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
  status: "active" as const,
  gmail_history_id: null,
  gmail_backfill_page_token: null,
  gmail_backfill_complete: false,
};

describe("runGmailSync failure handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listActiveSharedGmailAccount).mockResolvedValue(accountRow);
    vi.mocked(getDecryptedGmailAccount).mockResolvedValue(accountRow);
    vi.mocked(queryOne).mockResolvedValue({ id: accountRow.id } as never);
    vi.mocked(query).mockResolvedValue([] as never);
    vi.mocked(execute).mockResolvedValue({ rowCount: 1 } as never);
    vi.mocked(listMessageIds).mockResolvedValue({ messages: [] });
    vi.mocked(getProfile).mockResolvedValue({ emailAddress: accountRow.email, historyId: "history-2" });
    vi.mocked(refreshGmailAccessToken).mockResolvedValue({ access_token: "fresh-access-token", expires_in: 3600 });
  });

  it("keeps the connection active and retryable after a transient Gmail provider failure", async () => {
    vi.mocked(listMessageIds).mockRejectedValueOnce(new Error("Gmail messages.list failed (429): rate limit"));

    const result = await runGmailSync();

    expect(result.accounts[0]?.error).toMatch(/retry automatically/i);
    expect(recordGmailAccountSyncIssue).toHaveBeenCalledWith(accountRow.id, "provider_retry_pending");
    expect(markGmailAccountError).not.toHaveBeenCalled();
  });

  it("expires a rejected access token and leaves the account active for automatic refresh", async () => {
    vi.mocked(listMessageIds).mockResolvedValueOnce({ messages: [{ id: "message-1", threadId: "thread-1" }] });
    vi.mocked(getMessage).mockRejectedValueOnce(new Error("Gmail API failed (401): Unauthorized"));

    const result = await runGmailSync();

    expect(result.accounts[0]?.error).toMatch(/refreshed automatically/i);
    expect(recordGmailAccountSyncIssue).toHaveBeenCalledWith(accountRow.id, "access_token_refresh_pending");
    expect(markGmailAccountError).not.toHaveBeenCalled();
    expect(updateGmailBackfillState).not.toHaveBeenCalled();
  });

  it("marks only a genuinely invalid refresh grant as requiring reconnection", async () => {
    const expiredAccount = { ...accountRow, token_expires_at: null };
    vi.mocked(getDecryptedGmailAccount).mockResolvedValueOnce(expiredAccount);
    vi.mocked(refreshGmailAccessToken).mockRejectedValueOnce(new Error("invalid_grant"));

    const result = await runGmailSync();

    expect(result.accounts[0]?.error).toMatch(/authorization expired or was revoked/i);
    expect(markGmailAccountError).toHaveBeenCalledWith(accountRow.id, "reauth_required:invalid_grant");
    expect(recordGmailAccountSyncIssue).not.toHaveBeenCalled();
  });

  it("continues syncing on the next run using the refreshed access token", async () => {
    const expiredAccount = { ...accountRow, token_expires_at: null };
    vi.mocked(getDecryptedGmailAccount)
      .mockResolvedValueOnce(accountRow)
      .mockResolvedValueOnce(expiredAccount);
    vi.mocked(listMessageIds)
      .mockResolvedValueOnce({ messages: [{ id: "message-1", threadId: "thread-1" }] })
      .mockResolvedValueOnce({ messages: [] });
    vi.mocked(getMessage).mockRejectedValueOnce(new Error("Gmail API failed (401): Unauthorized"));

    const rejectedTokenRun = await runGmailSync();
    const automaticRetryRun = await runGmailSync();

    expect(rejectedTokenRun.accounts[0]?.error).toMatch(/refreshed automatically/i);
    expect(automaticRetryRun.accounts[0]?.error).toBeUndefined();
    expect(recordGmailAccountSyncIssue).toHaveBeenNthCalledWith(1, accountRow.id, "access_token_refresh_pending");
    expect(refreshGmailAccessToken).toHaveBeenCalledWith(accountRow.refresh_token);
    expect(saveEncryptedGmailTokens).toHaveBeenCalledWith(expect.objectContaining({
      id: accountRow.id,
      accessToken: "fresh-access-token",
    }));
    expect(updateGmailHistoryId).toHaveBeenCalledWith(accountRow.id, "history-2");
  });
});
