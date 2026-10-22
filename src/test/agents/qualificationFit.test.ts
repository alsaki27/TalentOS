import { describe, expect, it } from "vitest";
import {
  computeQualificationFit,
  resolveQualificationJobDescription,
} from "@/lib/ai/application-agents/qualificationFit";
import type { JobAnalysisV1, RequirementAnalysisEntry } from "@/lib/ai/application-agents/schemas";

const jobDescription = [
  "The successful candidate will support the engineering team and deliver reliable technical work.",
  "The position involves professional experience using Python and SQL to maintain data systems.",
  "Candidates should communicate clearly and collaborate with business stakeholders.",
].join(" ");

function requirement(
  text: string,
  status: RequirementAnalysisEntry["status"],
  sourceEvidence: string[] = [],
): RequirementAnalysisEntry {
  return {
    requirement: text,
    category: "skill",
    sourceEvidence,
    status,
    safeToAdd: status === "supported_by_resume" || status === "supported_but_not_surfaced",
  };
}

function analysis(requirementAnalysis: RequirementAnalysisEntry[]): JobAnalysisV1 {
  return {
    title: "Data Systems Engineer",
    company: "Example Co",
    location: null,
    requiredSkills: ["Python", "SQL"],
    preferredSkills: [],
    tools: ["Python", "SQL"],
    methodologies: [],
    certifications: [],
    seniority: null,
    domain: "Data engineering",
    atsKeywords: ["Python", "SQL"],
    responsibilities: ["Maintain data systems"],
    evidenceRequirements: [],
    prohibitedUnsupportedClaims: [],
    ambiguities: [],
    rawSummary: "Data systems engineering role.",
    requirementAnalysis,
  };
}

function input(requirementAnalysis: RequirementAnalysisEntry[]) {
  return {
    jobDescription,
    jobTitle: "Data Systems Engineer",
    jobAnalysis: analysis(requirementAnalysis),
    baseResume: {
      content: {
        skills: ["Python", "SQL"],
        experience: [],
        education: [],
        certifications: [],
      },
    },
    evaluatedAt: "2026-10-19T00:00:00.000Z",
  };
}

describe("computeQualificationFit", () => {
  it("scores only source-cited qualifications and produces a reproducible result", () => {
    const result = computeQualificationFit(input([
      requirement("Python", "supported_by_resume", ["base.skills[0]"]),
      requirement("SQL", "supported_but_not_surfaced", ["base.skills[1]"]),
    ]));

    expect(result.status).toBe("scored");
    expect(result.score).toBe(10);
    expect(result.evidenceCoverage).toBe(100);
    expect(result.criteria.every((criterion) => criterion.evidenceExcerpts.length > 0)).toBe(true);
  });

  it("requires review when a hard blocker has no verified evidence, even if it is the only criterion", () => {
    const result = computeQualificationFit({
      ...input([{
        ...requirement("Active security clearance", "hard_blocker"),
        category: "clearance",
      }]),
      jobDescription: `${jobDescription} The role requires an active security clearance before work begins.`,
    });

    expect(result.status).toBe("needs_review");
    expect(result.score).toBeNull();
    expect(result.evidenceCoverage).toBe(0);
    expect(result.criteria[0].status).toBe("hard_requirement_not_evidenced");
  });

  it("does not award a hard requirement from a valid pointer to unrelated candidate text", () => {
    const result = computeQualificationFit({
      ...input([requirement("AWS", "supported_by_resume", ["base.skills[1]"])]),
      jobDescription: "This role requires AWS skills to build dependable data systems for a technical team.",
      baseResume: { content: { skills: ["Terraform", "SQL"], experience: [], education: [], certifications: [] } },
    });

    expect(result.status).toBe("needs_review");
    expect(result.score).toBeNull();
    expect(result.criteria[0].status).toBe("not_evidenced");
    expect(result.criteria[0].evidence).toEqual([]);
  });

  it("shows an uncertainty range when candidate evidence coverage is below the point-score threshold", () => {
    const result = computeQualificationFit(input([
      requirement("Python", "supported_by_resume", ["base.skills[0]"]),
      requirement("SQL", "unsupported"),
      requirement("communicate clearly", "unsupported"),
    ]));

    expect(result.status).toBe("provisional");
    expect(result.score).toBeNull();
    expect(result.scoreRange).toEqual({ min: 6.7, max: 10 });
    expect(result.evidenceCoverage).toBeLessThan(result.minimumEvidenceCoverage);
  });

  it("keeps a numeric range for grounded requirements when another extracted requirement cannot be anchored to the job", () => {
    const result = computeQualificationFit(input([
      requirement("Python", "supported_by_resume", ["base.skills[0]"]),
      requirement("PMP certification", "unsupported"),
    ]));

    expect(result.status).toBe("needs_review");
    expect(result.score).toBeNull();
    expect(result.scoreRange).toEqual({ min: 5, max: 10 });
    expect(result.jobGroundingCoverage).toBe(50);
    expect(result.criteria.find((criterion) => criterion.requirement === "PMP certification"))
      .toMatchObject({ status: "job_unverified", jobGrounded: false, resolved: false });
    expect(result.summary).toContain("could not be anchored");
  });

  it("matches reviewed technical aliases without weakening candidate citation checks", () => {
    const result = computeQualificationFit({
      ...input([requirement("GIS", "supported_by_resume", ["base.skills[0]"])]),
      jobDescription: "The role supports a geographic information system and reliable spatial data operations.",
      baseResume: { content: { skills: ["GIS"], experience: [], education: [], certifications: [] } },
    });

    expect(result.jobGroundingCoverage).toBe(100);
    expect(result.criteria[0]).toMatchObject({ jobGrounded: true, status: "meets" });
    expect(result.status).toBe("scored");
    expect(result.score).toBe(10);
  });

  it("resolves whole experience-record citations from the frozen resume snapshot", () => {
    const result = computeQualificationFit({
      ...input([requirement("Python", "supported_by_resume", ["base.experience[0]"])]),
      baseResume: {
        content: {
          skills: [],
          experience: [{ title: "Python Developer", bullets: ["Built Python automation for data systems."] }],
          education: [],
          certifications: [],
        },
      },
    });

    expect(result.criteria[0]).toMatchObject({ status: "meets", evidence: ["base.experience[0]"] });
    expect(result.criteria[0].evidenceExcerpts[0]).toContain("Python automation");
  });

  it("resolves legacy confirmed-skill citations for credential evidence", () => {
    const result = computeQualificationFit({
      ...input([{
        ...requirement("Security+", "supported_by_resume", ["confirmed:Security+"]),
        category: "cert",
      }]),
      jobDescription: "The successful candidate has a Security+ certification and experience supporting technical systems.",
      sourceOfTruthSkills: ["Security+"],
      baseResume: { content: { skills: [], experience: [], education: [], certifications: [] } },
    });

    expect(result.criteria[0]).toMatchObject({ status: "meets", evidence: ["confirmed:Security+"] });
  });

  it("uses an exact confirmed skill match if Resume Forge marked the requirement unsupported", () => {
    const result = computeQualificationFit({
      ...input([requirement("Python", "unsupported")]),
      sourceOfTruthSkills: ["Python"],
      baseResume: { content: { skills: [], experience: [], education: [], certifications: [] } },
    });

    expect(result.criteria[0]).toMatchObject({ status: "meets", evidence: ["sot:Python"] });
    expect(result.status).toBe("scored");
    expect(result.score).toBe(10);
  });

  it("does not match a skill by an accidental substring", () => {
    const result = computeQualificationFit({
      ...input([requirement("Java", "unsupported")]),
      jobDescription: "This role requires Java development and reliable data systems experience for a collaborative technical team.",
      baseResume: { content: { skills: [], experience: [], education: [], certifications: [] } },
      sourceOfTruthSkills: ["JavaScript"],
    });

    expect(result.criteria[0].status).toBe("not_evidenced");
    expect(result.score).toBeNull();
  });

  it("does not produce an exact point score when a hard requirement is unknown", () => {
    const result = computeQualificationFit({
      ...input([
        {
          ...requirement("Active security clearance", "hard_blocker"),
          category: "clearance",
        },
        requirement("Python", "supported_by_resume", ["base.skills[0]"]),
      ]),
      jobDescription: `${jobDescription} The role requires an active security clearance before work begins.`,
    });

    expect(result.status).toBe("needs_review");
    expect(result.score).toBeNull();
    expect(result.scoreRange).not.toBeNull();
    expect(result.summary).toContain("hard requirements lack confirmed candidate evidence");
  });

  it("caps a documented hard minimum-experience shortfall at 4.0 without treating it as an auto-rejection", () => {
    const description = [
      "The successful candidate will support the engineering team and deliver reliable technical work.",
      "This role requires a minimum of 4 years of relevant GIS data management experience.",
      "Candidates should communicate clearly and collaborate with business stakeholders.",
    ].join(" ");
    const result = computeQualificationFit({
      ...input([requirement("GIS data management", "supported_by_resume", ["base.experience[0].bullets[0]"])]),
      jobDescription: description,
      baseResume: {
        content: {
          skills: ["GIS"],
          experience: [{
            title: "GIS Technician",
            startDate: "2025-01",
            endDate: "2025-12",
            bullets: ["Maintained GIS data and geospatial records."],
          }],
          education: [],
          certifications: [],
        },
      },
    });

    expect(result.status).toBe("needs_review");
    expect(result.score).not.toBeNull();
    expect(result.score).toBeLessThanOrEqual(4);
    expect(result.criteria.find((criterion) => criterion.category === "minimum_experience")?.status)
      .toBe("below_minimum_experience");
  });

  it("does not infer a hard experience failure from undated candidate history", () => {
    const description = [
      "The successful candidate will support the engineering team and deliver reliable technical work.",
      "This role requires a minimum of 4 years of relevant GIS data management experience.",
      "Candidates should communicate clearly and collaborate with business stakeholders.",
    ].join(" ");
    const result = computeQualificationFit({
      ...input([requirement("GIS data management", "supported_by_resume", ["base.experience[0].bullets[0]"])]),
      jobDescription: description,
      baseResume: {
        content: {
          skills: ["GIS"],
          experience: [{ title: "GIS Technician", bullets: ["Maintained GIS data systems."] }],
          education: [],
          certifications: [],
        },
      },
    });

    expect(result.status).toBe("needs_review");
    expect(result.score).toBeNull();
    expect(result.criteria.find((criterion) => criterion.category === "minimum_experience")?.status)
      .toBe("experience_needs_verification");
  });

  it("treats an absent relevant role as missing evidence, not zero years of experience", () => {
    const description = [
      "The successful candidate will support the engineering team and deliver reliable technical work.",
      "This role requires a minimum of 4 years of relevant GIS data management experience.",
      "Candidates should communicate clearly and collaborate with business stakeholders.",
    ].join(" ");
    const result = computeQualificationFit({
      ...input([requirement("GIS data management", "unsupported")]),
      jobDescription: description,
      baseResume: {
        content: {
          skills: ["Python"],
          experience: [{ title: "Software Engineer", startDate: "2020-01", endDate: "2024-12", bullets: ["Built web applications."] }],
          education: [],
          certifications: [],
        },
      },
    });

    expect(result.status).toBe("needs_review");
    expect(result.score).toBeNull();
    expect(result.criteria.find((criterion) => criterion.category === "minimum_experience")?.status)
      .toBe("experience_needs_verification");
  });
});

describe("resolveQualificationJobDescription", () => {
  it("prefers the job description over internal notes", () => {
    expect(resolveQualificationJobDescription({
      description: "Authoritative job description",
      notes: "Internal note",
    })).toBe("Authoritative job description");
  });
});
