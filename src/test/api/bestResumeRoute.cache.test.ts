// Phase 6 (2026-09-28): /api/jobs/best-resume used to fire N uncached AI
// calls (one per base resume) every time it was invoked, even for the exact
// same (job, candidate) pair. These tests pin the new cache check, mirroring
// the sibling /api/jobs/match-score route's existing cache contract exactly.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  query: vi.fn(),
  queryOne: vi.fn(),
  callWithUsageTracking: vi.fn(),
  findSoTByCandidateId: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/auth", () => ({
  requireCurrentUser: mocks.requireCurrentUser,
  MASTER_DATA_MANAGER_ROLES: ["admin", "manager"],
}));
vi.mock("@/server/db/neon", () => ({
  query: mocks.query,
  queryOne: mocks.queryOne,
}));
vi.mock("@/lib/ai/routing", () => ({
  callWithUsageTracking: mocks.callWithUsageTracking,
}));
vi.mock("@/server/repositories/sourceOfTruthRepository", () => ({
  findSoTByCandidateId: mocks.findSoTByCandidateId,
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/jobs/best-resume/route";

const BASE_RESUMES = [
  { id: "resume-a", name: "Resume A", content: {} },
  { id: "resume-b", name: "Resume B", content: {} },
];

function req(body: Record<string, unknown>) {
  return new NextRequest("https://talentos.test/api/jobs/best-resume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/jobs/best-resume — cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCurrentUser.mockResolvedValue({ context: { profile: { user_id: "u1" } }, response: null });
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM base_resumes")) return BASE_RESUMES;
      return [];
    });
  });

  it("returns the cached winner without calling the AI when a valid cache row exists", async () => {
    mocks.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM job_match_scores")) {
        return { base_resume_id: "resume-b", score: 87, breakdown: JSON.stringify({ skills_match: 90, experience_match: 80, reasoning: "cached" }) };
      }
      return null;
    });

    const res = await POST(req({ job_id: "job-1", candidate_id: "cand-1" }));
    const json = await res.json();

    expect(mocks.callWithUsageTracking).not.toHaveBeenCalled();
    expect(json.best_resume_id).toBe("resume-b");
    expect(json.best_resume_name).toBe("Resume B");
    expect(json.score).toBe(87);
    expect(json.cache_hit).toBe(true);
  });

  it("re-scores when no cache row exists", async () => {
    mocks.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM job_match_scores")) return null;
      if (sql.includes("FROM jobs")) return { title: "Engineer", description_text: "A real job description", raw_description: null };
      if (sql.includes("FROM candidates")) return { verified_skills: [] };
      if (sql.includes("INSERT INTO job_match_scores")) return { id: "row-1" };
      return null;
    });
    mocks.callWithUsageTracking.mockImplementation(async (_id: string, _ctx: any, fn: any) => ({
      result: { score: "70", skills_match: "70", experience_match: "70", reasoning: "ok" },
    }));

    const res = await POST(req({ job_id: "job-1", candidate_id: "cand-1" }));
    const json = await res.json();

    expect(mocks.callWithUsageTracking).toHaveBeenCalledTimes(2); // once per base resume
    expect(json.cache_hit).toBeUndefined();
  });

  it("bypasses a valid cache row when force_rescore is set", async () => {
    mocks.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM job_match_scores")) {
        return { base_resume_id: "resume-b", score: 87, breakdown: JSON.stringify({ skills_match: 90, experience_match: 80, reasoning: "cached" }) };
      }
      if (sql.includes("FROM jobs")) return { title: "Engineer", description_text: "A real job description", raw_description: null };
      if (sql.includes("FROM candidates")) return { verified_skills: [] };
      if (sql.includes("INSERT INTO job_match_scores")) return { id: "row-1" };
      return null;
    });
    mocks.callWithUsageTracking.mockImplementation(async () => ({
      result: { score: "95", skills_match: "95", experience_match: "95", reasoning: "fresh" },
    }));

    const res = await POST(req({ job_id: "job-1", candidate_id: "cand-1", force_rescore: true }));
    const json = await res.json();

    expect(mocks.callWithUsageTracking).toHaveBeenCalledTimes(2);
    expect(json.cache_hit).toBeUndefined();
  });

  it("falls through to re-score when the cached winning resume no longer exists", async () => {
    mocks.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM job_match_scores")) {
        return { base_resume_id: "resume-deleted", score: 87, breakdown: JSON.stringify({ skills_match: 90, experience_match: 80, reasoning: "cached" }) };
      }
      if (sql.includes("FROM jobs")) return { title: "Engineer", description_text: "A real job description", raw_description: null };
      if (sql.includes("FROM candidates")) return { verified_skills: [] };
      if (sql.includes("INSERT INTO job_match_scores")) return { id: "row-1" };
      return null;
    });
    mocks.callWithUsageTracking.mockImplementation(async () => ({
      result: { score: "60", skills_match: "60", experience_match: "60", reasoning: "fresh" },
    }));

    const res = await POST(req({ job_id: "job-1", candidate_id: "cand-1" }));
    const json = await res.json();

    expect(mocks.callWithUsageTracking).toHaveBeenCalledTimes(2);
    expect(json.cache_hit).toBeUndefined();
  });
});
