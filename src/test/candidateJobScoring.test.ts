import { describe, expect, test } from "vitest";
import { scoreStage1, reconcileTier, type ScoringCandidate, type ScoringResume, type ScoringJob } from "@/server/services/candidateJobScoring";

const TERMS = [
  "Civil Engineer", "AutoCAD", "Civil 3D", "site design", "grading", "drainage",
  "stormwater", "land development", "construction documents", "permitting",
  "project coordination", "technical reports", "quality control", "GIS",
  "hydrology", "utilities", "roadway design", "erosion control", "surveying",
];

function candidate(overrides: Partial<ScoringCandidate> = {}): ScoringCandidate {
  return {
    id: "cand-1",
    name: "Test Candidate",
    work_authorization: "U.S. citizen; authorized without sponsorship",
    visa_status: "Citizen",
    preferred_locations: "Illinois",
    priority: "default",
    preferences: {},
    custom_requirements: "",
    ...overrides,
  };
}

function resume(overrides: Partial<ScoringResume> = {}): ScoringResume {
  return {
    id: "resume-1",
    candidate_id: "cand-1",
    name: "Civil engineering resume",
    target_industry: "Civil Engineering",
    target_roles: TERMS,
    content: TERMS.join(" "),
    status: "approved",
    ...overrides,
  };
}

function job(overrides: Partial<ScoringJob> = {}): ScoringJob {
  return {
    job_id: "job-1",
    title: "Civil Design Engineer",
    company: "Example Engineering",
    location: "Chicago, IL",
    seniority_level: "Associate",
    freshnessReferenceDate: "2026-08-07T12:00:00.000Z",
    requires_citizenship: false,
    citizenship_countries: null,
    export_control_restricted: false,
    eligibility_restriction_evidence: null,
    ...overrides,
  };
}

const DESCRIPTION = `${TERMS.join(" ")}. The engineer prepares plans, calculations, reports, and construction documents for land development projects. Minimum 3 years experience.`;

describe("scoreStage1 (lane-breadth)", () => {
  test("does not turn an explicitly unnecessary clearance into an eligibility blocker",()=> {
    const result=scoreStage1(candidate(),[resume()],`${DESCRIPTION} No security clearance is required.`,job(),365);
    expect(result.hardGates.some(gate=>/clearance/i.test(gate))).toBe(false);
  });
  test("scores every resume and ranks the best first", () => {
    const strongResume = resume({ id: "strong", name: "Strong fit" });
    const weakResume = resume({ id: "weak", name: "Weak fit", target_roles: ["unrelated field", "retail sales", "customer service"], content: "Retail sales associate with customer service experience." });
    const result = scoreStage1(candidate(), [strongResume, weakResume], DESCRIPTION, job(), 365);

    expect(result.bestResume?.id).toBe("strong");
    expect(result.rankedResumes).toHaveLength(2);
    expect(result.rankedResumes[0].resumeId).toBe("strong");
    expect(result.rankedResumes[0].score).toBeGreaterThan(result.rankedResumes[1].score);
  });

  test("hard gates are collected (free-text + structured) but never exclude the best pick", () => {
    const result = scoreStage1(
      candidate({ preferences: {} }),
      [resume()],
      `${DESCRIPTION} Must be a U.S. citizen and hold an active secret security clearance.`,
      job({ requires_citizenship: true, citizenship_countries: ["United States"] }),
      365,
    );
    // The free-text citizenship gate from candidateJobMatcher.ts and the
    // structured gate (no citizenshipStatus recorded) should both surface -
    // scoreStage1 itself never drops bestResume because of them; the caller
    // decides what to do with the warning.
    expect(result.bestResume).not.toBeNull();
    expect(result.hardGates.length).toBeGreaterThan(0);
  });

  test("structured citizenship preference resolves the structured gate when it proves citizenship", () => {
    const result = scoreStage1(
      candidate({ preferences: { citizenshipStatus: "US Citizen" } }),
      [resume()],
      DESCRIPTION,
      job({ requires_citizenship: true, citizenship_countries: ["United States"] }),
      365,
    );
    expect(result.hardGates.some((gate) => gate.includes("no citizenship status is recorded"))).toBe(false);
  });

  test("no usable resumes returns a null best pick and zero score", () => {
    const result = scoreStage1(candidate(), [], DESCRIPTION, job(), 365);
    expect(result.bestResume).toBeNull();
    expect(result.bestScore).toBe(0);
    expect(result.rankedResumes).toEqual([]);
  });
});

describe("reconcileTier", () => {
  test("uses the configured cross-check floor rather than a fixed 40", () => {
    expect(reconcileTier("strong", 35, 30)).toBe("strong");
    expect(reconcileTier("strong", 29, 30)).toBe("adjacent");
    expect(reconcileTier("strong", 30, 30)).toBe("strong");
    expect(reconcileTier("strong", 74, 75)).toBe("adjacent");
    expect(reconcileTier("strong", 75, 75)).toBe("strong");
  });
  test("downgrades an AI-claimed strong tier when the ATS floor score is very low", () => {
    expect(reconcileTier("strong", 10)).toBe("adjacent");
  });

  test("leaves strong alone when the ATS score is reasonably high", () => {
    expect(reconcileTier("strong", 80)).toBe("strong");
  });

  test("never upgrades a lower tier", () => {
    expect(reconcileTier("adjacent", 10)).toBe("adjacent");
    expect(reconcileTier("stretch", 5)).toBe("stretch");
    expect(reconcileTier("reject", 0)).toBe("reject");
  });
});
