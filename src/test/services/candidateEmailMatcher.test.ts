import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db/neon", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

import { query, queryOne } from "@/server/db/neon";
import { matchCandidateForMessage } from "@/server/services/candidateEmailMatcher";

beforeEach(() => {
  vi.clearAllMocks();
  (queryOne as any).mockResolvedValue(null); // no prior thread match, unless overridden
  (query as any).mockResolvedValue([]); // no matches at any tier, unless overridden
});

describe("matchCandidateForMessage", () => {
  it("tier 1: inherits the candidate from an earlier message in the same thread, without touching later tiers", async () => {
    (queryOne as any).mockResolvedValue({ candidate_id: "cand-thread" });

    const result = await matchCandidateForMessage({
      gmailThreadId: "thread-1",
      fromEmail: "someone@example.com",
      toEmails: [],
      bodyText: null,
    });

    expect(result).toEqual({ candidateId: "cand-thread", method: "thread_continuity" });
    expect(query).not.toHaveBeenCalled();
  });

  it("returns unresolved when there are no addresses to check at all", async () => {
    const result = await matchCandidateForMessage({
      gmailThreadId: "thread-2",
      fromEmail: null,
      toEmails: [],
      bodyText: null,
    });
    expect(result).toEqual({ candidateId: null, method: null });
    expect(query).not.toHaveBeenCalled();
  });

  it("tier 2: matches a single candidate by direct email", async () => {
    (query as any).mockResolvedValueOnce([{ id: "cand-direct" }]);

    const result = await matchCandidateForMessage({
      gmailThreadId: "thread-3",
      fromEmail: "recruiter@company.com",
      toEmails: ["candidate@gmail.com"],
      bodyText: null,
    });

    expect(result).toEqual({ candidateId: "cand-direct", method: "candidate_email" });
  });

  it("tier 2: stays unresolved when more than one candidate shares an address in the set", async () => {
    (query as any).mockResolvedValueOnce([{ id: "cand-a" }, { id: "cand-b" }]);

    const result = await matchCandidateForMessage({
      gmailThreadId: "thread-4",
      fromEmail: "recruiter@company.com",
      toEmails: ["candidate@gmail.com"],
      bodyText: null,
    });

    expect(result).toEqual({ candidateId: null, method: null });
  });

  it("tier 3: falls back to a known Gmail contact when no direct candidate email matches", async () => {
    (query as any)
      .mockResolvedValueOnce([]) // tier 2: no direct match
      .mockResolvedValueOnce([{ candidate_id: "cand-contact" }]); // tier 3: one known contact

    const result = await matchCandidateForMessage({
      gmailThreadId: "thread-5",
      fromEmail: "recruiter@company.com",
      toEmails: [],
      bodyText: null,
    });

    expect(result).toEqual({ candidateId: "cand-contact", method: "known_contact" });
  });

  it("tier 3: stays unresolved when a contact address is linked to more than one candidate", async () => {
    (query as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ candidate_id: "cand-a" }, { candidate_id: "cand-b" }]);

    const result = await matchCandidateForMessage({
      gmailThreadId: "thread-6",
      fromEmail: "recruiter@company.com",
      toEmails: [],
      bodyText: null,
    });

    expect(result).toEqual({ candidateId: null, method: null });
  });

  it("tier 4: matches by company domain when exactly one candidate has an active application there", async () => {
    (query as any)
      .mockResolvedValueOnce([]) // tier 2
      .mockResolvedValueOnce([]) // tier 3
      .mockResolvedValueOnce([{ candidate_id: "cand-domain" }]); // tier 4

    const result = await matchCandidateForMessage({
      gmailThreadId: "thread-7",
      fromEmail: "hr@acmecorp.com",
      toEmails: [],
      bodyText: null,
    });

    expect(result).toEqual({ candidateId: "cand-domain", method: "company_domain" });
  });

  it("tier 4: two candidates sharing the same ATS/company domain stays unresolved rather than guessing", async () => {
    (query as any)
      .mockResolvedValueOnce([]) // tier 2
      .mockResolvedValueOnce([]) // tier 3
      .mockResolvedValueOnce([{ candidate_id: "cand-a" }, { candidate_id: "cand-b" }]); // tier 4: ambiguous

    const result = await matchCandidateForMessage({
      gmailThreadId: "thread-8",
      fromEmail: "no-reply@greenhouse.io",
      toEmails: [],
      bodyText: null,
    });

    expect(result).toEqual({ candidateId: null, method: null });
  });

  it("never treats a personal webmail domain (gmail.com) as a company domain to match on", async () => {
    (query as any)
      .mockResolvedValueOnce([]) // tier 2
      .mockResolvedValueOnce([]); // tier 3

    const result = await matchCandidateForMessage({
      gmailThreadId: "thread-9",
      fromEmail: "someone@gmail.com",
      toEmails: [],
      bodyText: null,
    });

    // Only two query() calls should have happened - tier 4 is skipped
    // entirely because every candidate address domain is personal webmail.
    expect(query).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ candidateId: null, method: null });
  });

  it("recovers the original sender from a manually-forwarded message's quoted header block", async () => {
    (query as any).mockResolvedValueOnce([{ id: "cand-forwarded" }]); // tier 2, matched via the forwarded From

    const body = [
      "FYI, please handle.",
      "",
      "---------- Forwarded message ---------",
      "From: Jane Recruiter <jane@company.com>",
      "Date: Mon, Sep 1, 2026 at 10:00 AM",
      "Subject: Interview invitation",
      "To: Candidate Name <candidate@gmail.com>",
    ].join("\n");

    const result = await matchCandidateForMessage({
      gmailThreadId: "thread-10",
      fromEmail: "forwarder@internalstaff.com",
      toEmails: [],
      bodyText: body,
    });

    expect(result).toEqual({ candidateId: "cand-forwarded", method: "candidate_email" });
    // The address set passed to the query should include the recovered
    // forwarded addresses, not just the forwarder's own address.
    const addressesArg = (query as any).mock.calls[0][1][0];
    expect(addressesArg).toEqual(expect.arrayContaining(["jane@company.com", "candidate@gmail.com"]));
  });
});
