import { describe, expect, test } from "vitest";
import { gmailSuppressionReason } from "@/lib/integrations/gmailSuppression";

describe("candidate Gmail pre-storage suppression", () => {
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
