import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listMissingApplicationQuestions } from "@/server/services/candidateApplicationFactsService";
import type { CandidateApplicationFact } from "@/lib/candidateApplicationFacts";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/server/db/neon", () => ({ query, queryOne: vi.fn() }));

const candidateId = "00000000-0000-0000-0000-000000000011";
const otherCandidateId = "00000000-0000-0000-0000-000000000012";
const jobId = "00000000-0000-0000-0000-000000000013";
const secondJobId = "00000000-0000-0000-0000-000000000014";
const applicationId = "00000000-0000-0000-0000-000000000021";
const secondApplicationId = "00000000-0000-0000-0000-000000000022";
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
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("BROWSER_WORKER_QUEUE_ENABLED", "false");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("deduplicates the same candidate question across jobs and ignores malformed labels", async () => {
    query.mockResolvedValue([
      { applicationId, status: "needs_human", jobId, jobTitle: "Sample Role", detectedAt,
        questions: ["Can you commute?", "  can you COMMUTE? ", "Can  you commute?", "", 12, "x".repeat(401)] },
      { applicationId: secondApplicationId, status: "needs_human", jobId: secondJobId, jobTitle: null,
        detectedAt, questions: ["Can you commute?"] },
    ]);
    const missing = await listMissingApplicationQuestions(candidateId, {}, []);
    expect(missing).toEqual([
      { jobId, jobTitle: "Sample Role", detectedAt, question: "Can you commute?" },
    ]);
    expect(query).toHaveBeenCalledWith(expect.any(String), [candidateId]);
  });

  it("uses the same candidate-wide approval rules as the worker and holds an unreviewed revision", async () => {
    query.mockResolvedValue([
      { applicationId, status: "needs_human", jobId, detectedAt, questions: ["Can you commute?", "Do you have a degree?"] },
      { applicationId: secondApplicationId, status: "needs_human", jobId: secondJobId, detectedAt, questions: ["Can you commute?"] },
    ]);
    const draft: CandidateApplicationFact = { ...reusable, id: "draft", jobId, reviewState: "draft" };
    const otherCandidate: CandidateApplicationFact = { ...reusable, id: "other", candidateId: otherCandidateId, question: "Do you have a degree?" };
    const missing = await listMissingApplicationQuestions(candidateId, {}, [reusable, draft, otherCandidate]);
    expect(missing.map(({ jobId, question }) => ({ jobId, question }))).toEqual([
      { jobId, question: "Can you commute?" },
      { jobId, question: "Do you have a degree?" },
    ]);
  });

  it("clears contact prompts using already approved aliases from another legacy job", async () => {
    query.mockResolvedValue([
      { applicationId, status: "needs_human", jobId, detectedAt, questions: ["Full name", "Email address"] },
      { applicationId: secondApplicationId, status: "needs_human", jobId: secondJobId, detectedAt,
        questions: ["Name", "E-mail address", "Do you have a degree?"] },
    ]);
    const name = { ...reusable, id: "name", jobId: secondJobId, question: "Name", valueKind: "text" as const, value: "Sample Applicant" };
    const email = { ...reusable, id: "email", jobId: secondJobId, question: "Email", valueKind: "text" as const, value: "sample@example.test" };
    await expect(listMissingApplicationQuestions(candidateId, {}, [name, email])).resolves.toEqual([
      { jobId: secondJobId, detectedAt, question: "Do you have a degree?" },
    ]);
  });

  it("uses the latest screening observation across the pilot and dedicated worker without hiding another ticket", async () => {
    vi.stubEnv("BROWSER_WORKER_QUEUE_ENABLED", "true");
    const later = "2026-11-10T10:00:00.000Z";
    query.mockResolvedValueOnce([
      { applicationId, status: "needs_human", jobId, detectedAt, questions: ["Can you commute?"] },
    ]).mockResolvedValueOnce([
      { applicationId, status: "prepared", jobId, detectedAt: later, questions: [] },
      { applicationId: secondApplicationId, status: "needs_human", jobId: secondJobId, detectedAt: later,
        jobTitle: "Another Role", questions: ["Mobile phone number"] },
    ]);
    await expect(listMissingApplicationQuestions(candidateId, {}, [])).resolves.toEqual([
      { jobId: secondJobId, jobTitle: "Another Role", detectedAt: later, question: "Mobile phone number" },
    ]);
  });

  it("keeps the answer bank available without the optional worker tables", async () => {
    query.mockRejectedValue({ code: "42P01" });
    await expect(listMissingApplicationQuestions(candidateId, {}, [])).resolves.toEqual([]);
  });
});
