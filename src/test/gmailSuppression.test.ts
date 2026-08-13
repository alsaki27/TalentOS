import { describe, expect, test } from "vitest";
import { gmailSuppressionReason, classifyGmailMessage } from "@/lib/integrations/gmailSuppression";

describe("candidate Gmail pre-storage suppression", () => {
  // Regression contract: every case that reached gmailSuppressionReason
  // before Chunk A must return the exact same value now, unchanged.
  test("suppresses job alerts", () => {
    expect(gmailSuppressionReason({ from: "alerts@indeed.com", subject: "New jobs match your alert" })).toBe("job_alert");
  });
  test("suppresses personal transactions and security codes", () => {
    expect(gmailSuppressionReason({ from: "notice@paypal.com", subject: "Your payment receipt" })).toBe("personal_transaction");
    expect(gmailSuppressionReason({ from: "security@chase.com", subject: "Your verification code" })).toBe("personal_transaction");
  });
  test("suppresses bulk marketing but retains a plausible recruiter conversation", () => {
    expect(gmailSuppressionReason({ from: "offers@example.com", subject: "Special offer — unsubscribe" })).toBe("bulk_marketing");
    expect(gmailSuppressionReason({ from: "recruiter@engineeringco.com", subject: "Interview availability", bodyText: "Can you meet the hiring manager Tuesday?" })).toBeNull();
  });
});

describe("classifyGmailMessage — job-board sender-shape rules (Chunk A)", () => {
  test("drops the exact live-leak shape pre-storage: single-job alert with a display-name From header", () => {
    // This is the shape that used to leak through: the sender regex matched
    // indeed.com but no content regex matched "job alert"/"jobs for you",
    // so the AI classified it application_invite/needs_reply=true. Uses the
    // display-name header form ("Name <addr>") since that's what
    // gmailApi.ts actually stores, and what parseSender must handle.
    const verdict = classifyGmailMessage({
      from: "SouthernStone Cabinets, LLC <noreply@indeed.com>",
      subject: "Cabinet Manufacturing Engineer @ SouthernStone Cabinets, LLC",
    });
    expect(verdict.suppress).toBe(true);
    expect(verdict.reason).toBe("job_board_alert");
    expect(verdict.forceNeedsReplyFalse).toBe(true);
    // The old delegate must also suppress this now (it didn't before Chunk A).
    expect(gmailSuppressionReason({
      from: "SouthernStone Cabinets, LLC <noreply@indeed.com>",
      subject: "Cabinet Manufacturing Engineer @ SouthernStone Cabinets, LLC",
    })).toBe("job_alert");
  });

  test("drops a machine-alert local part on a job-board domain even with a generic subject", () => {
    const verdict = classifyGmailMessage({ from: "job-alerts-noreply@linkedin.com", subject: "3 new jobs for you" });
    expect(verdict.suppress).toBe(true);
    expect(verdict.reason).toBe("job_board_alert");
  });

  test("store-but-hide: broader alert-shaped subject on a job-board domain, ambiguous local part", () => {
    // "info" isn't in ALERT_LOCAL, HUMAN_RELAY_LOCAL, or NO_REPLY_LOCAL, so
    // this can only be caught by the subject-content heuristic - exactly
    // the fuzzier tier that gets stored-but-hidden instead of dropped.
    const verdict = classifyGmailMessage({ from: "info@ziprecruiter.com", subject: "You look like a great fit — 5 new jobs near you" });
    expect(verdict.suppress).toBe(false);
    expect(verdict.storeButHide).toBe(true);
    expect(verdict.reason).toBe("job_board_alert");
  });

  test("never suppresses a human relay on a job-board domain, regardless of local-part shape", () => {
    const verdict = classifyGmailMessage({
      from: "Sarah Chen <inmail-hit-reply@linkedin.com>",
      subject: "Sarah sent you a message",
      bodyText: "Hi — I saw your profile and wanted to ask about your availability for a call.",
    });
    expect(verdict.suppress).toBe(false);
    expect(verdict.storeButHide).toBe(false);
    expect(verdict.senderClass).toBe("human");
    expect(verdict.forceNeedsReplyFalse).toBe(false);
  });

  test("rescues a no-reply job-board sender that turns out to be a real human message, but still forces needsReply=false", () => {
    const verdict = classifyGmailMessage({
      from: "Indeed <noreply@indeed.com>",
      subject: "Message from Acme Corp about your application",
      bodyText: "Thanks for applying. Are you available Tuesday for a phone screen?",
    });
    expect(verdict.suppress).toBe(false);
    expect(verdict.storeButHide).toBe(false);
    expect(verdict.forceNeedsReplyFalse).toBe(true);
  });

  test("does not loosen the personal_transaction AND-gate: a recruiting domain shared with a retail brand still needs content to match", () => {
    const verdict = classifyGmailMessage({ from: "careers@amazon.com", subject: "Your interview with Amazon" });
    expect(verdict.suppress).toBe(false);
    expect(verdict.reason).toBeNull();
  });

  test("forceNeedsReplyFalse is true for any no-reply sender, independent of job-board domain", () => {
    const verdict = classifyGmailMessage({ from: "no-reply@somecompany-ats.com", subject: "Your application status" });
    expect(verdict.suppress).toBe(false);
    expect(verdict.senderClass).toBe("no_reply");
    expect(verdict.forceNeedsReplyFalse).toBe(true);
  });

  test("snippet parity: identical verdict whether the distinguishing text is in snippet or bodyText", () => {
    const bySnippet = classifyGmailMessage({ from: "recruiter@engineeringco.com", subject: "Following up", snippet: "Are you available for a phone screen this week?" });
    const byBody = classifyGmailMessage({ from: "recruiter@engineeringco.com", subject: "Following up", bodyText: "Are you available for a phone screen this week?" });
    expect(bySnippet).toEqual(byBody);
  });
});
