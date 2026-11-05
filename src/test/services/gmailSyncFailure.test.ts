import { describe, expect, it } from "vitest";
import { classifyGmailSyncFailure } from "@/server/services/gmailSyncFailure";

describe("classifyGmailSyncFailure", () => {
  it.each(["invalid_grant", "no_refresh_token"])("requires OAuth reconnection for %s", (message) => {
    expect(classifyGmailSyncFailure(new Error(message))).toMatchObject({
      kind: "reauthorize",
      storedCode: `reauth_required:${message}`,
    });
  });

  it("refreshes a rejected access token without marking the mailbox disconnected", () => {
    expect(classifyGmailSyncFailure(new Error("Gmail messages.list failed (401): Unauthorized"))).toMatchObject({
      kind: "refresh_access_token",
      storedCode: "access_token_refresh_pending",
    });
  });

  it.each([
    new Error("Gmail messages.list failed (429): rate limit"),
    new Error("fetch failed"),
  ])("retries provider and network errors without reconnecting", (error) => {
    expect(classifyGmailSyncFailure(error)).toMatchObject({
      kind: "retry_sync",
      storedCode: "provider_retry_pending",
    });
  });
});
