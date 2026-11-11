import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { GET, PATCH, POST } from "@/app/api/candidates/[id]/application-facts/route";

const services = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  loadApplicationFactProfile: vi.fn(),
  listCandidateApplicationFacts: vi.fn(),
  listMissingApplicationQuestions: vi.fn(),
  createApplicationFactDraft: vi.fn(),
  reviseApplicationFact: vi.fn(),
  reviewApplicationFact: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireCurrentUser: services.requireCurrentUser,
  MASTER_DATA_MANAGER_ROLES: ["admin", "manager"],
}));
vi.mock("@/server/services/candidateApplicationFactsService", () => services);

const candidateId = "00000000-0000-0000-0000-000000000011";
const factId = "00000000-0000-0000-0000-000000000012";
const params = { params: { id: candidateId } };
const actor = "00000000-0000-0000-0000-000000000013";
const validDraft = {
  section: "Eligibility",
  question: "Can you commute?",
  sourceKind: "candidate_attested",
  sourceRef: "attestation-1",
  disposition: "known",
  valueKind: "boolean",
  value: false,
};

function request(method: string, body?: object) {
  return new Request("https://app.example.test/api/candidates/facts", {
    method, body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("Candidate application facts API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    services.requireCurrentUser.mockResolvedValue({ context: { profile: { user_id: actor } }, response: null });
    services.loadApplicationFactProfile.mockResolvedValue({ name: "Sample Applicant" });
  });

  it("requires candidate data manager roles for read and write before querying any facts", async () => {
    services.requireCurrentUser.mockResolvedValue({
      response: NextResponse.json({ error: "Permission denied" }, { status: 403 }),
    });
    expect((await GET(request("GET"), params)).status).toBe(403);
    expect((await POST(request("POST", validDraft), params)).status).toBe(403);
    expect((await PATCH(request("PATCH", { factId, operation: "approve", expectedRevision: 1 }), params)).status).toBe(403);
    expect(services.requireCurrentUser).toHaveBeenCalledTimes(3);
    expect(services.requireCurrentUser).toHaveBeenCalledWith(["admin", "manager"]);
    expect(services.loadApplicationFactProfile).not.toHaveBeenCalled();
    expect(services.listMissingApplicationQuestions).not.toHaveBeenCalled();
    expect(services.reviewApplicationFact).not.toHaveBeenCalled();
  });

  it("returns job-scoped missing questions alongside the authenticated candidate's facts", async () => {
    const facts = [{ id: factId, reviewState: "draft" }];
    const missingQuestions = [{ jobId: factId, question: "Can you commute?", detectedAt: "2026-11-09T10:00:00Z" }];
    services.listCandidateApplicationFacts.mockResolvedValue(facts);
    services.listMissingApplicationQuestions.mockResolvedValue(missingQuestions);
    const response = await GET(request("GET"), params);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ facts, missingQuestions });
    expect(services.listMissingApplicationQuestions).toHaveBeenCalledWith(candidateId, { name: "Sample Applicant" }, facts);
  });

  it("writes drafts for the URL candidate and requires a separate review operation", async () => {
    services.createApplicationFactDraft.mockResolvedValue({ id: factId, reviewState: "draft" });
    const response = await POST(request("POST", { ...validDraft, candidateId: "ignored", reviewState: "approved" }), params);
    expect(response.status).toBe(201);
    expect(services.createApplicationFactDraft).toHaveBeenCalledWith(candidateId, expect.objectContaining({ value: false }), actor);
    expect(services.reviewApplicationFact).not.toHaveBeenCalled();
    expect((await response.json()).fact.reviewState).toBe("draft");
  });

  it("binds approval to the authenticated actor, candidate, and expected revision", async () => {
    services.reviewApplicationFact.mockResolvedValue(null);
    const response = await PATCH(request("PATCH", { factId, operation: "approve", expectedRevision: 3, reviewedBy: "ignored" }), params);
    expect(response.status).toBe(409);
    expect(services.reviewApplicationFact).toHaveBeenCalledWith(candidateId, factId, 3, "approve", actor);
  });

  it("rejects a draft claiming a canonical profile value that has changed", async () => {
    const response = await POST(request("POST", {
      ...validDraft, sourceKind: "profile", sourceRef: "name", valueKind: "text", value: "Old Name",
    }), params);
    expect(response.status).toBe(409);
    expect(services.createApplicationFactDraft).not.toHaveBeenCalled();
  });
});
