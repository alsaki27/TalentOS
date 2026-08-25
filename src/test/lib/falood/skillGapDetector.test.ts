import { describe, it, expect } from "vitest";
import {
  detectSkillGaps,
  jdCoverageScore,
  filterSkillGapsForScoreIncrease,
  flattenResumeSkills,
} from "@/lib/falood/skillGapDetector";

describe("detectSkillGaps", () => {
  it("finds skills missing from the resume across JD, base resume, and Source of Truth", () => {
    const gaps = detectSkillGaps({
      resumeSkills: ["AutoCAD", "Revit"],
      jdSkills: ["AutoCAD", "Vetro FiberMap", "GIS"],
      baseResumeSkills: ["AutoCAD", "Revit", "GIS", "ArcGIS"],
      sourceOfTruthSkills: ["GIS", "Python"],
    });
    const skillNames = gaps.map((g) => g.skill);
    expect(skillNames).toContain("Vetro FiberMap");
    expect(skillNames).toContain("GIS");
    expect(skillNames).toContain("ArcGIS");
    expect(skillNames).toContain("Python");
    expect(skillNames).not.toContain("AutoCAD");
    expect(skillNames).not.toContain("Revit");
  });

  it("ranks skills corroborated by more sources first", () => {
    const gaps = detectSkillGaps({
      resumeSkills: [],
      jdSkills: ["GIS", "Python"],
      baseResumeSkills: ["GIS"],
      sourceOfTruthSkills: ["GIS"],
    });
    // GIS is in all 3 sources, Python only in JD - GIS must rank first.
    expect(gaps[0].skill).toBe("GIS");
    expect(gaps[0].inJobDescription && gaps[0].inBaseResume && gaps[0].inSourceOfTruth).toBe(true);
  });

  it("is case- and whitespace-insensitive when matching against the resume", () => {
    const gaps = detectSkillGaps({
      resumeSkills: ["  autocad  "],
      jdSkills: ["AutoCAD"],
      baseResumeSkills: [],
      sourceOfTruthSkills: [],
    });
    expect(gaps.map((g) => g.skill)).not.toContain("AutoCAD");
  });

  it("deduplicates the same skill appearing in multiple sources into one entry", () => {
    const gaps = detectSkillGaps({
      resumeSkills: [],
      jdSkills: ["Python"],
      baseResumeSkills: ["python"],
      sourceOfTruthSkills: ["PYTHON"],
    });
    expect(gaps.filter((g) => g.skill.toLowerCase() === "python")).toHaveLength(1);
  });
});

describe("jdCoverageScore", () => {
  it("returns 0 when the JD has no extracted skills", () => {
    expect(jdCoverageScore(["AutoCAD"], [])).toBe(0);
  });

  it("computes the fraction of JD skills already covered", () => {
    expect(jdCoverageScore(["AutoCAD"], ["AutoCAD", "Revit"])).toBe(0.5);
    expect(jdCoverageScore(["AutoCAD", "Revit"], ["AutoCAD", "Revit"])).toBe(1);
  });
});

describe("filterSkillGapsForScoreIncrease", () => {
  it("keeps only JD-corroborated skills that would raise coverage", () => {
    const gaps = detectSkillGaps({
      resumeSkills: [],
      jdSkills: ["AutoCAD", "Revit"],
      baseResumeSkills: ["ArcGIS"], // not in JD at all
      sourceOfTruthSkills: [],
    });
    const filtered = filterSkillGapsForScoreIncrease(gaps, [], ["AutoCAD", "Revit"]);
    const names = filtered.map((g) => g.skill);
    expect(names).toContain("AutoCAD");
    expect(names).toContain("Revit");
    expect(names).not.toContain("ArcGIS"); // can't verify it raises JD coverage
  });

  it("suggests nothing when the JD yielded no skills to score against", () => {
    const gaps = detectSkillGaps({
      resumeSkills: [],
      jdSkills: [],
      baseResumeSkills: ["ArcGIS"],
      sourceOfTruthSkills: [],
    });
    expect(filterSkillGapsForScoreIncrease(gaps, [], [])).toHaveLength(0);
  });

  it("never suggests a skill that would not change coverage (already effectively present)", () => {
    const gaps = detectSkillGaps({
      resumeSkills: ["autocad"], // already covers "AutoCAD" case-insensitively
      jdSkills: ["AutoCAD"],
      baseResumeSkills: ["AutoCAD"],
      sourceOfTruthSkills: [],
    });
    // detectSkillGaps already excludes it since resumeSkills has it normalized-equal.
    expect(gaps.map((g) => g.skill)).not.toContain("AutoCAD");
  });
});

describe("flattenResumeSkills", () => {
  it("flattens simple-mode skills", () => {
    expect(flattenResumeSkills({ mode: "simple", simple: ["AutoCAD", "Revit"], categorized: [] })).toEqual(["AutoCAD", "Revit"]);
  });

  it("flattens categorized-mode skills across all categories", () => {
    expect(
      flattenResumeSkills({
        mode: "categorized",
        simple: [],
        categorized: [
          { skills: ["AutoCAD", "Revit"] },
          { skills: ["Python"] },
        ],
      })
    ).toEqual(["AutoCAD", "Revit", "Python"]);
  });

  it("handles null/undefined gracefully", () => {
    expect(flattenResumeSkills(null)).toEqual([]);
    expect(flattenResumeSkills(undefined)).toEqual([]);
  });
});
