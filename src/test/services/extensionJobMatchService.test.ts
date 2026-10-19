import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn(), evaluate: vi.fn() }));

vi.mock("@/server/db/neon", () => ({ query: mocks.query, queryOne: mocks.queryOne }));
vi.mock("@/lib/candidateJobMatcher", () => ({ evaluateCandidateJob: mocks.evaluate }));

import { getExtensionCandidateResumeOptions, listExtensionCandidates, validateExtensionResumeMatch } from "@/server/services/extensionJobMatchService";

async function hashResume(content: unknown) {
  const serialized = JSON.stringify(content ?? {});
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("extension candidate picker", () => {
  const resumeA = { experience: "GIS Analyst" };
  const resumeB = { experience: "GIS Specialist" };

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.queryOne.mockResolvedValue({
      id: "job-1", title: "GIS Analyst", company: "Northwind", location: "Remote",
      job_category: "Engineering",
      description_text: "A sufficiently detailed job description", raw_description: null,
      seniority_level: "mid", posted_at: "2026-10-18T12:00:00.000Z",
    });
    mocks.query.mockResolvedValue([
      { candidate_id: "candidate-1", candidate_name: "A. Candidate", pipeline_stage: "applying", base_resume_id: "resume-a", resume_name: "GIS Analyst Resume", resume_status: "approved", resume_updated_at: "2026-10-18T12:00:00Z", resume_content: resumeA, target_industry: null, target_roles: ["GIS Analyst"], profile_review_status: "approved", profile_version: 2, approved_profile_version: 2, resume_content_hash: await hashResume(resumeA), keywords: ["GIS"], keyword_states: null, additional_rules: null, work_authorization: null, visa_status: null, preferred_locations: null },
      { candidate_id: "candidate-1", candidate_name: "A. Candidate", pipeline_stage: "applying", base_resume_id: "resume-b", resume_name: "GIS Specialist Resume", resume_status: "approved", resume_updated_at: "2026-10-17T12:00:00Z", resume_content: resumeB, target_industry: "Engineering", target_roles: ["Project Manager"], profile_review_status: "approved", profile_version: 4, approved_profile_version: 4, resume_content_hash: await hashResume(resumeB), keywords: ["GIS"], keyword_states: null, additional_rules: null, work_authorization: null, visa_status: null, preferred_locations: null },
      { candidate_id: "candidate-1", candidate_name: "A. Candidate", pipeline_stage: "applying", base_resume_id: "resume-stale", resume_name: "Stale Resume", resume_updated_at: "2026-10-16T12:00:00Z", resume_content: { experience: "old copy" }, profile_review_status: "approved", profile_version: 1, approved_profile_version: 1, resume_content_hash: "stale-hash", keywords: ["GIS"], keyword_states: null, additional_rules: null, work_authorization: null, visa_status: null, preferred_locations: null },
      { candidate_id: "candidate-1", candidate_name: "A. Candidate", pipeline_stage: "applying", base_resume_id: "resume-unapproved", resume_name: "Unapproved Resume", resume_updated_at: "2026-10-15T12:00:00Z", resume_content: { experience: "GIS" }, profile_review_status: "pending", profile_version: 1, approved_profile_version: null, resume_content_hash: null, keywords: ["GIS"], keyword_states: null, additional_rules: null, work_authorization: null, visa_status: null, preferred_locations: null },
    ]);
    mocks.evaluate.mockImplementation((candidate: { resumeText: string }) => ({
      outcome: candidate.resumeText.includes("Analyst") ? "rejected" : "recommended",
      tier: candidate.resumeText.includes("Analyst") ? null : "A",
      score: candidate.resumeText.includes("Specialist") ? 93 : 65,
      reason: candidate.resumeText.includes("Analyst") ? "Score below recommendation threshold" : "Approved profile alignment",
      matchedTerms: ["GIS"], hardGates: [],
      scoreBreakdown: { title: 1, skills: 1, responsibilities: 1, seniority: 1, eligibility: 1, freshness: 1, penalties: 0 },
    }));
  });

  it("lists all active candidates, including already-logged candidates, without exposing email addresses", async () => {
    mocks.query.mockResolvedValueOnce([{ candidateId: "candidate-1", candidateName: "A. Candidate", pipelineStage: "applying", alreadyLogged: true }]);
    const candidates = await listExtensionCandidates("job-1");
    expect(candidates).toEqual([{ candidateId: "candidate-1", candidateName: "A. Candidate", pipelineStage: "applying", alreadyLogged: true }]);
    const [sql, params] = mocks.query.mock.calls.at(-1)!;
    expect(sql).toContain("c.status = 'active'");
    expect(sql).toContain('AS "alreadyLogged"');
    expect(sql).not.toContain("c.email");
    expect(sql).not.toContain("ILIKE");
    expect(sql).not.toContain("NOT EXISTS");
    expect(params).toEqual(["job-1"]);
  });

  it("scores all current approved resumes, keeps lower scores visible, and marks stale or unapproved resumes", async () => {
    const candidate = await getExtensionCandidateResumeOptions("job-1", "candidate-1", new Date("2026-10-19T00:00:00.000Z"));
    expect(candidate).toMatchObject({ candidateId: "candidate-1", candidateName: "A. Candidate", bestResumeId: "resume-a" });
    expect(candidate.resumeOptions.map((resume) => resume.baseResumeId)).toEqual(["resume-a", "resume-b", "resume-unapproved", "resume-stale"]);
    expect(candidate.resumeOptions[0]).toMatchObject({ score: 65, tier: null, recommended: false, talentOsDefault: true, profileStatus: "approved" });
    expect(candidate.resumeOptions[1]).toMatchObject({ score: 93, tier: "A", recommended: true, talentOsDefault: false, profileStatus: "approved" });
    expect(candidate.resumeOptions[2]).toMatchObject({ score: 1, scoreType: "local_resume_relevance", profileStatus: "not_approved" });
    expect(candidate.resumeOptions[3]).toMatchObject({ score: 0, scoreType: "local_resume_relevance", profileStatus: "stale" });
    expect(candidate.bestResumeId).toBe("resume-a");
  });

  it("revalidates a manually selected lower-scoring resume without rejecting the candidate", async () => {
    await expect(validateExtensionResumeMatch("job-1", "candidate-1", "resume-a", new Date("2026-10-19T00:00:00.000Z")))
      .resolves.toMatchObject({ candidate: { candidateId: "candidate-1" }, resume: { baseResumeId: "resume-a", score: 65, recommended: false } });
    await expect(validateExtensionResumeMatch("job-1", "candidate-1", "unknown-resume", new Date("2026-10-19T00:00:00.000Z")))
      .rejects.toThrow("no longer eligible");
  });

  it("does not score an approved profile when its current-resume hash is missing", async () => {
    mocks.query.mockResolvedValueOnce([{
      candidate_id: "candidate-1", candidate_name: "A. Candidate", pipeline_stage: "applying",
      base_resume_id: "resume-no-hash", resume_name: "Unverified resume", resume_updated_at: "2026-10-18T12:00:00Z",
      resume_content: resumeA, profile_review_status: "approved", profile_version: 1, approved_profile_version: 1,
      resume_content_hash: null, keywords: ["GIS"], keyword_states: null, additional_rules: null,
      work_authorization: null, visa_status: null, preferred_locations: null,
    }]);
    const candidate = await getExtensionCandidateResumeOptions("job-1", "candidate-1", new Date("2026-10-19T00:00:00.000Z"));
    expect(candidate.resumeOptions[0]).toMatchObject({ score: 2, scoreType: "local_resume_relevance", profileStatus: "stale" });
    expect(mocks.evaluate).not.toHaveBeenCalled();
  });

  it("fails clearly when the job is no longer active", async () => {
    mocks.queryOne.mockResolvedValue(null);
    await expect(getExtensionCandidateResumeOptions("job-1", "candidate-1")).rejects.toThrow("missing or inactive");
  });
});
