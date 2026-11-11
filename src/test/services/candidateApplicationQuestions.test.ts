import { beforeEach, describe, expect, it, vi } from "vitest";
import { listMissingApplicationQuestions } from "@/server/services/candidateApplicationFactsService";
import type { CandidateApplicationFact } from "@/lib/candidateApplicationFacts";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/server/db/neon", () => ({ query, queryOne: vi.fn() }));

const candidateId = "00000000-0000-0000-0000-000000000011";
const otherCandidateId = "00000000-0000-0000-0000-000000000012";
const jobId = "00000000-0000-0000-0000-000000000013";
const secondJobId = "00000000-0000-0000-0000-000000000014";
const detectedAt = "2026-11-09T10:00:00.000Z";
const reusable: CandidateApplicationFact = {
  id: "00000000-0000-0000-0000-000000000015",
  candidateId,
  jobId: null,
  section: "Eligibility",
  question: "Can you commute?",
  valueKind: "boolean",
  value: true,
  disposition: "known",
  sourceKind: "candidate_attested",
  sourceRef: "staff-verified",
  expiresAt: null,
  reviewState: "approved",
  reviewedBy: "reviewer",
  reviewedAt: detectedAt,
  revision: 1,
};

describe("Candidate application questions", () => {
  beforeEach(() => vi.resetAllMocks());

  it("deduplicates job-scoped prompts and ignores malformed labels", async () => {
    query.mockResolvedValue([
      { jobId, jobTitle: "Sample Role", detectedAt, questions: ["Can you commute?", "  can you COMMUTE? ", "", 12, "x".repeat(401)] },
      { jobId, jobTitle: "Sample Role", detectedAt, questions: ["Can  you commute?"] },
      { jobId: secondJobId, jobTitle: null, detectedAt, questions: ["Can you commute?"] },
    ]);
    const missing = await listMissingApplicationQuestions(candidateId, {}, []);
    expect(missing).toEqual([
      { jobId, jobTitle: "Sample Role", detectedAt, question: "Can you commute?" },
      { jobId: secondJobId, detectedAt, question: "Can you commute?" },
    ]);
    expect(query).toHaveBeenCalledWith(expect.any(String), [candidateId]);
  });

  it("uses the worker's approved-answer rules and honors a job-specific draft over a reusable approval", async () => {
    query.mockResolvedValue([
      { jobId, detectedAt, questions: ["Can you commute?", "Do you have a degree?"] },
      { jobId: secondJobId, detectedAt, questions: ["Can you commute?"] },
    ]);
    const draft: CandidateApplicationFact = { ...reusable, id: "draft", jobId, reviewState: "draft" };
    const otherCandidate: CandidateApplicationFact = { ...reusable, id: "other", candidateId: otherCandidateId, question: "Do you have a degree?" };
    const missing = await listMissingApplicationQuestions(candidateId, {}, [reusable, draft, otherCandidate]);
    expect(missing.map(({ jobId, question }) => ({ jobId, question }))).toEqual([
      { jobId, question: "Can you commute?" },
      { jobId, question: "Do you have a degree?" },
    ]);
  });

  it("keeps the answer bank available without the optional worker tables", async () => {
    query.mockRejectedValue({ code: "42P01" });
    await expect(listMissingApplicationQuestions(candidateId, {}, [])).resolves.toEqual([]);
  });
});
