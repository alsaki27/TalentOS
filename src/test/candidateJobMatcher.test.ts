import { describe, expect, test } from "vitest";
import { compileAdditionalRules, evaluateCandidateJob } from "@/lib/candidateJobMatcher";

const now = new Date("2026-08-09T12:00:00.000Z");
const terms = [
  "Civil Engineer", "AutoCAD", "Civil 3D", "site design", "grading", "drainage",
  "stormwater", "land development", "construction documents", "permitting",
  "project coordination", "technical reports", "quality control", "GIS",
  "hydrology", "utilities", "roadway design", "erosion control", "surveying",
  "client communication", "engineering calculations", "cost estimates", "blueprints",
  "Microsoft Office", "regulatory compliance", "field inspection", "design engineer",
  "FE exam", "EIT", "project delivery",
];

function evaluate(overrides: Record<string, unknown> = {}) {
  return evaluateCandidateJob(
    { workAuthorization: "U.S. citizen; authorized without sponsorship", visaStatus: "Citizen", preferredLocations: "Illinois", resumeText: terms.join(" ") },
    { activeTerms: terms, dismissedTerms: ["sales representative"], additionalRules: "Reject roles requiring more than 7 years" },
    {
      title: "Civil Design Engineer",
      company: "Example Engineering",
      location: "Chicago, IL",
      description: `${terms.join(" ")}. The engineer prepares plans, calculations, reports, and construction documents for land development projects. Minimum 3 years experience.`,
      seniorityLevel: "Associate",
      postedAt: "2026-08-07T12:00:00.000Z",
      ...overrides,
    },
    { now },
  );
}

describe("candidate-job matching policy", () => {
  test("recommends an explainable high-alignment recent job", () => {
    const result = evaluate();
    expect(result.outcome).toBe("recommended");
    expect(result.tier).toBe("A");
    expect(result.score).toBeGreaterThanOrEqual(85);
    expect(result.matchedTerms).toContain("Civil Engineer");
    expect(result.hardGates).toEqual([]);
  });

  test("rejects a job older than the exact seven-day window", () => {
    const result = evaluate({ postedAt: "2026-08-02T11:59:59.999Z" });
    expect(result.outcome).toBe("rejected");
    expect(result.hardGates).toContain("Job is older than 7 days");
  });

  test("includes the exact freshness boundary", () => {
    expect(evaluate({ postedAt: "2026-08-02T12:00:00.000Z" }).hardGates).not.toContain("Job is older than 7 days");
  });

  test("enforces approved additional-rule experience limits", () => {
    const result = evaluate({ description: `${terms.join(" ")}. This role requires 10 years experience delivering civil engineering projects.` });
    expect(result.outcome).toBe("rejected");
    expect(result.hardGates.some((gate) => gate.includes("above the approved 7-year limit"))).toBe(true);
  });

  test("does not infer citizenship or clearance", () => {
    const result = evaluate({ description: `${terms.join(" ")}. Must be a U.S. citizen and hold an active secret security clearance.` });
    expect(result.outcome).toBe("rejected");
    expect(result.hardGates).toContain("Required security clearance is not proven by the resume");
  });

  test("dismissed matches only reduce score and remain auditable", () => {
    const result = evaluate({ title: "Civil Engineer Sales Representative" });
    expect(result.dismissedTermHits).toContain("sales representative");
    expect(result.scoreBreakdown.penalties).toBeGreaterThan(0);
  });

  test("compiles only deterministic free-text rules and flags the remainder for review", () => {
    const rules = compileAdditionalRules("Reject roles requiring more than 5 years; Prefer hybrid teams with strong mentorship");
    expect(rules).toContainEqual(expect.objectContaining({ type: "maximum_experience", value: 5, severity: "hard_reject" }));
    expect(rules).toContainEqual(expect.objectContaining({ type: "human_review", severity: "review" }));
  });

  test("rejects an explicitly required credential that the resume does not prove", () => {
    const result = evaluate({ description: `${terms.join(" ")}. A Professional Engineer (PE) license is required.` });
    expect(result.hardGates).toContain("Required Professional Engineer (PE) license is not proven by the resume");
  });
});
