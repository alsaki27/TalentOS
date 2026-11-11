import { describe, expect, it } from "vitest";
import {
  parseApplicationFactDraft,
  resolveApplicationFacts,
  type CandidateApplicationFact,
} from "@/lib/candidateApplicationFacts";

const candidate = "00000000-0000-0000-0000-000000000001";
const otherCandidate = "00000000-0000-0000-0000-000000000002";
const job = "00000000-0000-0000-0000-000000000003";
const otherJob = "00000000-0000-0000-0000-000000000004";
const now = Date.parse("2026-11-08T00:00:00.000Z");

function fact(overrides: Partial<CandidateApplicationFact> = {}): CandidateApplicationFact {
  return {
    id: "00000000-0000-0000-0000-000000000005",
    candidateId: candidate,
    jobId: null,
    revision: 1,
    section: "Screening",
    question: "Can you commute to this job’s location?",
    disposition: "known",
    valueKind: "boolean",
    value: false,
    sourceKind: "candidate_attested",
    sourceRef: "attestation-1",
    expiresAt: null,
    reviewState: "approved",
    reviewedBy: "00000000-0000-0000-0000-000000000006",
    reviewedAt: "2026-11-07T00:00:00.000Z",
    ...overrides,
  };
}

describe("Candidate application facts", () => {
  it("validates typed values and keeps false and zero distinct from unknown", () => {
    const draft = fact();
    expect(parseApplicationFactDraft(draft)?.value).toBe(false);
    expect(parseApplicationFactDraft({ ...draft, valueKind: "integer", value: 0 })?.value).toBe(0);
    expect(parseApplicationFactDraft({ ...draft, value: "false" })).toBeNull();
    expect(parseApplicationFactDraft({ ...draft, disposition: "unknown", value: false })).toBeNull();
    expect(parseApplicationFactDraft({ ...draft, disposition: "declined", value: null })?.value).toBeNull();
    expect(parseApplicationFactDraft({ ...draft, valueKind: "date", value: "2026-02-30" })).toBeNull();
  });

  it("resolves a normalized exact label with evidence from this candidate and job only", () => {
    const row = fact({ jobId: job });
    const question = "CAN YOU COMMUTE TO THIS JOB'S LOCATION?";
    const result = resolveApplicationFacts([
      row,
      fact({ id: "cross-candidate", candidateId: otherCandidate, jobId: job, value: true }),
      fact({ id: "cross-job", jobId: otherJob, value: true }),
    ], candidate, job, {}, [question], now);
    expect(result.answers).toEqual({ [question]: "No" });
    expect(result.evidence).toEqual({
      [question]: { factId: row.id, revision: 1, sourceRef: "candidate_attested:attestation-1" },
    });
    expect(result.blocked).toEqual([]);
  });

  it("keeps a newer draft from leaking the previous approval and blocks generic fallback", () => {
    const previous = fact({ jobId: job });
    const result = resolveApplicationFacts([
      previous,
      fact({ id: "generic", value: true }),
      { ...previous, revision: 2, reviewState: "draft", reviewedBy: null, reviewedAt: null },
    ], candidate, job, {}, undefined, now);
    expect(result.answers).toEqual({});
    expect(result.blocked).toEqual([{ question: previous.question, reason: "unreviewed" }]);
  });

  it.each([
    [fact({ expiresAt: "2026-11-08T00:00:00.000Z" }), "expired"],
    [fact({ disposition: "declined", value: null }), "declined"],
    [fact({ disposition: "unknown", value: null }), "unknown"],
    [fact({ reviewState: "revoked" }), "unreviewed"],
    [fact({ sourceKind: "profile", sourceRef: "email", valueKind: "text", value: "old@example.test" }), "unreviewed"],
  ] as const)("blocks expired, declined, unknown, revoked, or stale source data", (row, reason) => {
    expect(resolveApplicationFacts([row], candidate, job, { email: "new@example.test" }, undefined, now))
      .toEqual({ answers: {}, evidence: {}, blocked: [{ question: row.question, reason }] });
  });

  it("blocks duplicate active facts and allows a reviewed answer after its duplicate is revoked", () => {
    const row = fact();
    const duplicate = fact({ id: "duplicate", value: true });
    expect(resolveApplicationFacts([row, duplicate], candidate, job, {}, undefined, now).blocked)
      .toEqual([{ question: row.question, reason: "conflict" }]);
    expect(resolveApplicationFacts([row, { ...duplicate, reviewState: "revoked" }], candidate, job, {}, undefined, now).answers)
      .toEqual({ [row.question]: "No" });
    expect(resolveApplicationFacts([row], candidate, job, {}, ["A different question"], now).blocked)
      .toEqual([{ question: "A different question", reason: "unknown" }]);
  });
});
