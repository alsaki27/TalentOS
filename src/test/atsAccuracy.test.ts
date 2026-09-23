import { describe, test, expect } from "vitest";
import { computeDeterministicScore, type AtsExtractionResult } from "@/lib/atsScoring";

const JANES_SKILLS = [
  "ArcGIS Pro",
  "ArcGIS Server",
  "QGIS",
  "AutoCAD",
  "LIDAR data processing",
  "engineering cost estimates",
  "splice schematics",
  "construction drawings",
  "as-built documentation",
  "bills of materials",
];

function buildExtraction(candidateSkills: string[], jobHardSkills: string[], jobNiceToHave: string[] = []): AtsExtractionResult {
  return {
    candidate: {
      skills: candidateSkills,
      yearsOfExperience: 5,
      education: [{ degree: "Bachelor's", field: "Engineering" }],
    },
    job: {
      hardSkills: jobHardSkills,
      niceToHaveSkills: jobNiceToHave,
      minYearsOfExperience: 3,
      educationRequirement: "Bachelor's",
    },
  };
}

describe("ATS keyword accuracy", () => {
  test("present skills should never appear as missing", () => {
    const resumeSkills = ["ArcGIS Pro", "QGIS", "AutoCAD", "Python", "GIS"];
    const jobKeywords = ["ArcGIS Pro", "QGIS", "AutoCAD", "Kubernetes", "Docker"];

    const expectedMissing = jobKeywords.filter((k) => !resumeSkills.includes(k));
    expect(expectedMissing).toEqual(["Kubernetes", "Docker"]);

    const presentSkillsReportedAsMissing = expectedMissing.filter((k) => resumeSkills.includes(k));
    expect(presentSkillsReportedAsMissing).toHaveLength(0);
  });

  test("deterministic scorer matches exact skills (Jane's real skills)", () => {
    const extraction = buildExtraction(
      JANES_SKILLS,
      ["ArcGIS Pro", "QGIS", "AutoCAD"],
    );

    const breakdown = computeDeterministicScore(extraction, 80);

    expect(breakdown.hardSkillsScore).toBe(100);
  });

  test("deterministic scorer correctly lowers score for genuinely missing skills", () => {
    const extraction = buildExtraction(
      JANES_SKILLS,
      ["ArcGIS Pro", "QGIS", "AutoCAD", "Kubernetes", "Docker"],
    );

    const breakdown = computeDeterministicScore(extraction, 80);

    expect(breakdown.hardSkillsScore).toBeLessThan(100);
  });

  test("all Jane's skills matched against a job requiring a subset", () => {
    const jobRequired = ["ArcGIS Pro", "QGIS", "AutoCAD"];
    const extraction = buildExtraction(JANES_SKILLS, jobRequired);

    const breakdown = computeDeterministicScore(extraction, 80);

    expect(breakdown.hardSkillsScore).toBe(100);
    expect(breakdown.overallScore).toBeGreaterThan(80);
  });

  test("case-insensitive skill matching", () => {
    const extraction = buildExtraction(
      ["ArcGIS Pro", "QGIS"],
      ["arcgis pro", "qgis"],
    );

    const breakdown = computeDeterministicScore(extraction, 80);

    expect(breakdown.hardSkillsScore).toBe(100);
  });

  test("substring skill matching (partial match counts as match)", () => {
    const extraction = buildExtraction(
      ["LIDAR data processing"],
      ["LIDAR"],
    );

    const breakdown = computeDeterministicScore(extraction, 80);

    expect(breakdown.hardSkillsScore).toBe(100);
  });

  test("missing skills identified through low hardSkillsScore", () => {
    const extraction = buildExtraction(
      JANES_SKILLS,
      ["ArcGIS Pro", "Kubernetes", "Docker", "Terraform", "Helm"],
    );

    const breakdown = computeDeterministicScore(extraction, 80);

    expect(breakdown.hardSkillsScore).toBe(20);
  });

  test("skills NOT in candidate are correctly not matched", () => {
    const resumeSkills = new Set(JANES_SKILLS.map((s) => s.toLowerCase()));
    const jobOnlySkills = ["Kubernetes", "Docker", "Terraform"];

    for (const skill of jobOnlySkills) {
      const matchedExact = resumeSkills.has(skill.toLowerCase());
      const matchedSubstring = Array.from(resumeSkills).some(
        (cs) => cs.includes(skill.toLowerCase()) || skill.toLowerCase().includes(cs),
      );
      expect(matchedExact || matchedSubstring).toBe(false);
    }
  });
});
