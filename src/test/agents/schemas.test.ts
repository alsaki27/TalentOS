// Hard test: agent schema runtime validation.
// Tests every schema with valid input, invalid input, and edge cases.

import { describe, it, expect } from "vitest";
import { JobAnalysisSchema, ResumeDraftSchema, ReviewScoreSchema, FinalResumeSchema } from "@/lib/ai/application-agents/schemas";

describe("JobAnalysisSchema", () => {
  const validInput = {
    title: "Software Engineer",
    company: "Acme Corp",
    location: "San Francisco, CA",
    requiredSkills: ["TypeScript", "React", "Node.js"],
    preferredSkills: ["Python", "AWS"],
    tools: ["Git", "Docker"],
    methodologies: ["Agile", "Scrum"],
    certifications: ["AWS Certified"],
    seniority: "Senior",
    domain: "Fintech",
    atsKeywords: ["TypeScript", "React", "distributed systems"],
    responsibilities: ["Build web applications", "Design APIs"],
    evidenceRequirements: ["Portfolio of React apps", "System design experience"],
    prohibitedUnsupportedClaims: ["Claims of management experience without evidence"],
    ambiguities: ["Team size not specified", "Remote policy unclear"],
    rawSummary: "Senior engineering role in fintech",
  };

  it("parses valid JobAnalysisV1", () => {
    const result = JobAnalysisSchema.parse(validInput);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.title).toBe("Software Engineer");
      expect(result.company).toBe("Acme Corp");
      expect(result.requiredSkills).toEqual(["TypeScript", "React", "Node.js"]);
      expect(result.location).toBe("San Francisco, CA");
    }
  });

  it("rejects non-object input", () => {
    const result = JobAnalysisSchema.parse("not an object");
    expect("error" in result).toBe(true);
  });

  it("rejects missing title", () => {
    const result = JobAnalysisSchema.parse({ company: "Acme" });
    expect("error" in result).toBe(true);
  });

  it("rejects missing company", () => {
    const result = JobAnalysisSchema.parse({ title: "Engineer" });
    expect("error" in result).toBe(true);
  });

  it("defaults missing optional arrays to empty", () => {
    const result = JobAnalysisSchema.parse({ title: "Engineer", company: "Acme" });
    if (!("error" in result)) {
      expect(result.requiredSkills).toEqual([]);
      expect(result.preferredSkills).toEqual([]);
      expect(result.tools).toEqual([]);
      expect(result.ambiguities).toEqual([]);
      expect(result.location).toBeNull();
    }
  });

  it("handles null location", () => {
    const result = JobAnalysisSchema.parse({ title: "Engineer", company: "Acme", location: null });
    if (!("error" in result)) {
      expect(result.location).toBeNull();
    }
  });
});

describe("ResumeDraftSchema", () => {
  const validDraft = {
    summary: "Experienced engineer",
    skills: ["TypeScript", "React"],
    experience: [{
      title: "Senior Engineer",
      company: "Tech Co",
      location: "Remote",
      startDate: "2020-01",
      endDate: null,
      bullets: ["Built platform", "Led team"],
      evidenceIds: ["ev-1", "ev-2"],
    }],
    education: [{ degree: "BS CS", school: "MIT", field: "Computer Science", graduationDate: "2015" }],
    certifications: ["AWS SA"],
    projects: [{ name: "Project X", description: "A project", technologies: ["React"] }],
    changeLog: [{ change: "Added skill", reason: "JD requires", evidenceId: "ev-1" }],
    missingRequirements: ["Kubernetes experience"],
    excludedKeywords: ["Legacy PHP"],
    truthRisks: [{ risk: "Claimed seniority without direct reports", severity: "medium" }],
  };

  it("parses valid ResumeDraftV1", () => {
    const result = ResumeDraftSchema.parse(validDraft);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.skills).toContain("TypeScript");
      expect(result.experience).toHaveLength(1);
      expect(result.experience[0].evidenceIds).toEqual(["ev-1", "ev-2"]);
      expect(result.truthRisks).toHaveLength(1);
      expect(result.truthRisks[0].severity).toBe("medium");
    }
  });

  it("rejects non-object input", () => {
    expect("error" in ResumeDraftSchema.parse(null)).toBe(true);
    expect("error" in ResumeDraftSchema.parse(42)).toBe(true);
  });

  it("filters invalid experience entries", () => {
    const result = ResumeDraftSchema.parse({
      summary: null,
      skills: [],
      experience: [
        { title: "Valid", company: "C", bullets: [], evidenceIds: [] },
        { company: "No title", bullets: [], evidenceIds: [] },
        "not an object",
      ],
      education: [],
      certifications: [],
      projects: [],
      changeLog: [],
      missingRequirements: [],
      excludedKeywords: [],
      truthRisks: [],
    });
    if (!("error" in result)) {
      expect(result.experience).toHaveLength(1);
    }
  });

  it("handles empty arrays", () => {
    const result = ResumeDraftSchema.parse({
      summary: null, skills: [], experience: [], education: [],
      certifications: [], projects: [], changeLog: [],
      missingRequirements: [], excludedKeywords: [], truthRisks: [],
    });
    expect("error" in result).toBe(false);
  });
});

describe("ReviewScoreSchema", () => {
  const validScore = {
    atsScore: 8,
    recruiterScore: 7,
    roleFitScore: 6,
    truthfulnessRisk: 2,
    formattingIssues: ["Font inconsistency"],
    requiredEdits: [{ issueId: "r1", description: "Add more keywords", severity: "major" }],
    optionalEdits: [{ issueId: "o1", description: "Consider adding summary" }],
    passFail: "pass",
    overallComment: "Strong candidate",
  };

  it("parses valid ReviewScoreV1", () => {
    const result = ReviewScoreSchema.parse(validScore);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.atsScore).toBe(8);
      expect(result.passFail).toBe("pass");
      expect(result.requiredEdits).toHaveLength(1);
    }
  });

  it("rejects missing atsScore", () => {
    expect("error" in ReviewScoreSchema.parse({ passFail: "pass" })).toBe(true);
  });

  it("defaults missing passFail to 'review' rather than rejecting", () => {
    const result = ReviewScoreSchema.parse({ atsScore: 5, recruiterScore: 5, roleFitScore: 5 });
    if (!("error" in result)) {
      expect(result.passFail).toBe("review");
    }
  });

  it("rejects missing recruiterScore", () => {
    expect("error" in ReviewScoreSchema.parse({ atsScore: 5, roleFitScore: 5, passFail: "pass" })).toBe(true);
  });

  it("rejects missing roleFitScore", () => {
    expect("error" in ReviewScoreSchema.parse({ atsScore: 5, recruiterScore: 5, passFail: "pass" })).toBe(true);
  });

  it("defaults missing optional fields", () => {
    const result = ReviewScoreSchema.parse({ atsScore: 5, recruiterScore: 5, roleFitScore: 5, passFail: "pass" });
    if (!("error" in result)) {
      expect(result.truthfulnessRisk).toBe(0);
      expect(result.formattingIssues).toEqual([]);
      expect(result.overallComment).toBe("");
    }
  });

  it("coerces invalid passFail to 'review'", () => {
    const result = ReviewScoreSchema.parse({ atsScore: 5, recruiterScore: 5, roleFitScore: 5, passFail: "invalid_value" });
    if (!("error" in result)) {
      expect(result.passFail).toBe("review");
    }
  });

  it("rejects invalid severity values in requiredEdits", () => {
    const result = ReviewScoreSchema.parse({
      atsScore: 5, recruiterScore: 5, roleFitScore: 5, passFail: "pass",
      requiredEdits: [
        { issueId: "r2", description: "Invalid severity", severity: "extreme" },
      ],
    });
    expect("error" in result).toBe(true);
  });
});

describe("FinalResumeSchema", () => {
  it("parses valid FinalResumeV1", () => {
    const result = FinalResumeSchema.parse({
      summary: "Final summary",
      skills: ["React"],
      experience: [],
      education: [],
      certifications: [],
      projects: [],
      appliedIssueIds: ["r1"],
      rejectedIssueIds: [{ issueId: "o1", reason: "Not applicable" }],
      unresolvedWarnings: [],
      finalQaScore: 9,
      exportReady: true,
    });
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.appliedIssueIds).toEqual(["r1"]);
      expect(result.exportReady).toBe(true);
      expect(result.finalQaScore).toBe(9);
    }
  });

  it("handles exportReady false", () => {
    const result = FinalResumeSchema.parse({
      summary: null, skills: [], experience: [], education: [],
      certifications: [], projects: [], appliedIssueIds: [], rejectedIssueIds: [],
      unresolvedWarnings: [], finalQaScore: 0, exportReady: false,
    });
    if (!("error" in result)) {
      expect(result.exportReady).toBe(false);
    }
  });
});
