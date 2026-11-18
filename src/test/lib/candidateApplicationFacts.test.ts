import { describe, expect, it } from "vitest";
import {
  APPLICATION_PROFILE_NOTES_SECTION,
  applicationQuestionKey,
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
  it("keeps staff notes out of the worker even when a legacy client approved a note", () => {
    const note = fact({ section: APPLICATION_PROFILE_NOTES_SECTION, valueKind: "text", value: "Private staff context" });
    expect(parseApplicationFactDraft(note)).not.toBeNull();
    expect(parseApplicationFactDraft({ ...note, jobId: job })?.jobId).toBeNull();
    expect(resolveApplicationFacts([note], candidate, job, {}, undefined, now))
      .toEqual({ answers: {}, evidence: {}, blocked: [] });
    expect(resolveApplicationFacts([note], candidate, job, {}, [note.question], now).answers).toEqual({});
  });

  it("validates typed values and keeps false and zero distinct from unknown", () => {
    const draft = fact();
    expect(parseApplicationFactDraft(draft)?.value).toBe(false);
    expect(parseApplicationFactDraft({ ...draft, valueKind: "integer", value: 0 })?.value).toBe(0);
    expect(parseApplicationFactDraft({ ...draft, value: "false" })).toBeNull();
    expect(parseApplicationFactDraft({ ...draft, disposition: "unknown", value: false })).toBeNull();
    expect(parseApplicationFactDraft({ ...draft, disposition: "declined", value: null })?.value).toBeNull();
    expect(parseApplicationFactDraft({ ...draft, valueKind: "date", value: "2026-02-30" })).toBeNull();
  });

  it("reuses identical approved answers from legacy jobs while isolating the candidate", () => {
    const row = fact({ jobId: job });
    const question = "CAN YOU COMMUTE TO THIS JOB'S LOCATION?";
    const result = resolveApplicationFacts([
      row,
      fact({ id: "cross-candidate", candidateId: otherCandidate, jobId: job, value: true }),
      fact({ id: "cross-job", jobId: otherJob, value: false }),
    ], candidate, job, {}, [question], now);
    expect(result.answers).toEqual({ [question]: "No" });
    expect(result.evidence).toEqual({
      [question]: { factId: row.id, revision: 1, sourceRef: "candidate_attested:attestation-1" },
    });
    expect(result.blocked).toEqual([]);
  });

  it("keeps a newer draft from leaking the previous approval across applications", () => {
    const previous = fact({ jobId: job });
    const result = resolveApplicationFacts([
      previous,
      fact({ id: "generic", value: true }),
      { ...previous, revision: 2, reviewState: "draft", reviewedBy: null, reviewedAt: null },
    ], candidate, job, {}, undefined, now);
    expect(result.answers).toEqual({});
    expect(result.blocked).toEqual([{ question: previous.question, reason: "conflict" }]);
  });

  it("saves all answers at candidate scope while validating legacy job IDs", () => {
    expect(parseApplicationFactDraft(fact({ jobId: job }))?.jobId).toBeNull();
    expect(parseApplicationFactDraft({ ...fact(), jobId: "invalid" })).toBeNull();
  });

  it("reuses approved contact aliases from a different application with their original evidence", () => {
    const name = fact({ id: "name", jobId: otherJob, question: "Name", valueKind: "text", value: "Sample Applicant" });
    const email = fact({ id: "email", jobId: otherJob, question: "E-mail", valueKind: "text", value: "sample@example.test" });
    const result = resolveApplicationFacts([name, email], candidate, job, {}, undefined, now);
    expect(result.answers).toEqual({ "Full name": "Sample Applicant", "Email address": "sample@example.test" });
    expect(result.evidence["Full name"]).toMatchObject({ factId: name.id, revision: 1 });
    expect(result.evidence["Email address"]).toMatchObject({ factId: email.id, revision: 1 });
    expect(resolveApplicationFacts([name, email], candidate, job, {}, ["Full name", "Email address"], now).blocked).toEqual([]);
    expect(applicationQuestionKey("  EMAIL address ")).toBe(applicationQuestionKey("E-mail"));
    expect(applicationQuestionKey("LinkedIn profile name")).not.toBe(applicationQuestionKey("Full name"));
    expect(applicationQuestionKey("Mobile phone number")).toBe(applicationQuestionKey("Phone number"));
    expect(applicationQuestionKey("Work phone number")).not.toBe(applicationQuestionKey("Phone number"));
  });

  it("does not silently choose between different candidate answers from legacy jobs", () => {
    const result = resolveApplicationFacts([
      fact({ id: "first", jobId: job }),
      fact({ id: "second", jobId: otherJob, value: true }),
    ], candidate, otherJob, {}, undefined, now);
    expect(result.answers).toEqual({});
    expect(result.blocked).toEqual([{ question: fact().question, reason: "conflict" }]);
  });

  it("requires every duplicate approval to remain usable before collapsing it", () => {
    const approved = fact({ id: "approved", jobId: job });
    const duplicate = fact({ id: "duplicate", jobId: otherJob, reviewState: "draft", reviewedBy: null, reviewedAt: null });
    expect(resolveApplicationFacts([approved, duplicate], candidate, job, {}, undefined, now).blocked)
      .toEqual([{ question: approved.question, reason: "unreviewed" }]);
    expect(resolveApplicationFacts([approved, { ...duplicate, reviewState: "approved", reviewedBy: "reviewer", reviewedAt: "2026-11-07T00:00:00Z", expiresAt: "2026-11-07T00:00:00Z" }], candidate, job, {}, undefined, now).blocked)
      .toEqual([{ question: approved.question, reason: "expired" }]);
  });

  it("includes an approved answer expiry in its evidence and omits it for nonexpiring facts", () => {
    const expiresAt = "2026-11-09T00:00:00.000Z";
    const row = fact({ expiresAt });
    const result = resolveApplicationFacts([row], candidate, job, {}, undefined, now);
    expect(result.answers).toEqual({ [row.question]: "No" });
    expect(result.evidence[row.question]).toEqual({
      factId: row.id, revision: row.revision, sourceRef: "candidate_attested:attestation-1", expiresAt,
    });
    const nonexpiring = resolveApplicationFacts([fact()], candidate, job, {}, undefined, now);
    expect(Object.hasOwn(nonexpiring.evidence[row.question], "expiresAt")).toBe(false);
  });

  it("bounds collapsed duplicate approvals by their earliest expiry without replacing selected provenance", () => {
    const selected = fact({ id: "first", expiresAt: null });
    const soon = fact({ id: "second", expiresAt: "2026-11-09T00:00:00.000Z" });
    const later = fact({ id: "third", expiresAt: "2026-11-10T00:00:00.000Z" });
    for (const rows of [[selected, soon, later], [later, soon, selected]]) {
      expect(resolveApplicationFacts(rows, candidate, job, {}, undefined, now).evidence[selected.question]).toEqual({
        factId: selected.id, revision: selected.revision, sourceRef: "candidate_attested:attestation-1",
        expiresAt: soon.expiresAt,
      });
      expect(resolveApplicationFacts(rows, candidate, job, {}, undefined, Date.parse(soon.expiresAt!)))
        .toEqual({ answers: {}, evidence: {}, blocked: [{ question: selected.question, reason: "expired" }] });
    }
  });

  it.each([
    { reviewState: "draft", reviewedBy: null, reviewedAt: null },
    { expiresAt: "2026-11-07T00:00:00Z" },
  ] satisfies Partial<CandidateApplicationFact>[])("surfaces contradictory known values before individual usability blockers", (overrides) => {
    const approved = fact({ id: "approved", question: "Email address", valueKind: "text", value: "first@example.test" });
    const duplicate = fact({ id: "duplicate", question: "E-mail", valueKind: "text", value: "second@example.test", ...overrides });
    for (const rows of [[approved, duplicate], [duplicate, approved]]) {
      expect(resolveApplicationFacts(rows, candidate, job, {}, undefined, now))
        .toEqual({ answers: {}, evidence: {}, blocked: [{ question: "Email address", reason: "conflict" }] });
    }
  });

  it("compares typed values and never revives an expired latest revision", () => {
    const approved = fact({ id: "approved", valueKind: "integer", value: 3 });
    const differentlyTyped = fact({ id: "duplicate", valueKind: "text", value: "3", reviewState: "draft", reviewedBy: null, reviewedAt: null });
    expect(resolveApplicationFacts([approved, differentlyTyped], candidate, job, {}, undefined, now).blocked)
      .toEqual([{ question: approved.question, reason: "conflict" }]);
    expect(resolveApplicationFacts([approved, { ...approved, revision: 2, expiresAt: "2026-11-07T00:00:00Z" }], candidate, job, {}, undefined, now))
      .toEqual({ answers: {}, evidence: {}, blocked: [{ question: approved.question, reason: "expired" }] });
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
