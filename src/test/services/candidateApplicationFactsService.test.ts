import { beforeEach, describe, expect, it, vi } from "vitest";
import { getApprovedApplicationAnswers, listCandidateApplicationFacts } from "@/server/services/candidateApplicationFactsService";

const mocks = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn() }));
vi.mock("@/server/db/neon", () => ({ query: mocks.query, queryOne: mocks.queryOne, sql: vi.fn() }));

const candidateId = "00000000-0000-0000-0000-000000000001";
const requestedJob = "00000000-0000-0000-0000-000000000002";
const legacyJob = "00000000-0000-0000-0000-000000000003";
const approvedName = {
  id: "00000000-0000-0000-0000-000000000004", candidateId, jobId: legacyJob, revision: 1,
  section: "Contact", question: "Name", disposition: "known", valueKind: "text", value: "Sample Applicant",
  sourceKind: "profile", sourceRef: "name", expiresAt: null, reviewState: "approved",
  reviewedBy: "reviewer", reviewedAt: "2026-11-18T00:00:00.000Z",
};

describe("candidate-wide application facts retrieval", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.query.mockResolvedValue([approvedName]);
    mocks.queryOne.mockResolvedValue({ name: "Sample Applicant" });
  });

  it("loads the candidate's legacy facts without filtering them to the requested job", async () => {
    await expect(listCandidateApplicationFacts(candidateId, requestedJob)).resolves.toMatchObject([approvedName]);
    const [statement, values] = mocks.query.mock.calls[0];
    expect(values).toEqual([candidateId]);
    expect(statement).not.toContain('WHERE "jobId"');
    expect(statement).toContain("WHERE candidate_id = $1");
  });

  it("provides the worker's canonical contact label with the existing approval evidence", async () => {
    const result = await getApprovedApplicationAnswers(candidateId, requestedJob);
    expect(result.answers).toEqual({ "Full name": "Sample Applicant" });
    expect(result.evidence["Full name"]).toEqual({ factId: approvedName.id, revision: 1, sourceRef: "profile:name" });
    expect(result.blocked).toEqual([]);
    expect(mocks.query).toHaveBeenCalledWith(expect.any(String), [candidateId]);
  });

  it("withholds a previously approved profile fact after the profile value changes", async () => {
    mocks.queryOne.mockResolvedValue({ name: "New Name" });
    const result = await getApprovedApplicationAnswers(candidateId, requestedJob, ["Full name"]);
    expect(result.answers).toEqual({});
    expect(result.blocked).toEqual([{ question: "Full name", reason: "unreviewed" }]);
  });
});
