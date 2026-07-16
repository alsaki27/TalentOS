// src/test/services/readinessService.test.ts
// Ported from talentOS-B readiness-engine/test/readiness.test.ts
// Adapted from node:test/assert to vitest

import { describe, it, expect } from "vitest";
import { computeReadinessScore, DEFAULT_THRESHOLD } from "@/server/services/readinessService";

describe("computeReadinessScore", () => {
  it("returns 0 when no skills data is available", () => {
    const result = computeReadinessScore({
      jdText: "This job requires excellent communication skills.",
      candidate: {},
      evidenceSkills: [],
      resumeSkills: [],
      resumeTextCorpus: "",
    });
    expect(result.score).toBe(0);
    expect(result.no_skills_data).toBe(true);
    expect(result.matched).toEqual([]);
    expect(result.flagged).toEqual([]);
  });

  it("computes high score when skills and resume match JD perfectly", () => {
    // Provide rich data: verified + evidence skills, target_roles matching JD, and a dense resume corpus
    const jd = "Must know React, TypeScript, and Node.js. SQL experience required. Senior React Engineer role.";
    const result = computeReadinessScore({
      jdText: jd,
      candidate: {
        verified_skills: ["react", "typescript", "node.js", "sql"],
        target_roles: ["React Engineer"],
      },
      evidenceSkills: ["react", "typescript", "node.js", "sql"],
      resumeSkills: ["react", "typescript", "node.js", "sql"],
      // Dense corpus: many JD keywords appear here
      resumeTextCorpus: "Senior React TypeScript engineer with extensive Node.js and SQL experience. Built production React applications using TypeScript. Managed SQL databases and Node.js backends. React SQL TypeScript Node.",
    });
    // Skills: 4 matched out of targetSkillCount=max(5,4*0.5)=5 → skillMatchScore=(4/5)*100=80
    // Density: rich overlap → resumeMatchScore near 100
    // Role: matched → roleAlignmentScore=100
    // Weighted: 80*0.6 + ~100*0.2 + 100*0.2 = 48+20+20 = 88
    expect(result.score).toBeGreaterThan(60);
    expect(result.matched).toContain("react");
    expect(result.matched).toContain("typescript");
    expect(result.matched).toContain("node.js");
    expect(result.matched).toContain("sql");
    expect(result.flagged).toEqual([]);
  });

  it("computes partial score when some skills match and others don't", () => {
    const result = computeReadinessScore({
      jdText: "React TypeScript Node.js SQL Git required.",
      candidate: { verified_skills: ["react", "typescript", "aws"] },
      evidenceSkills: [],
      resumeSkills: [],
      resumeTextCorpus: "I know React and TypeScript.",
    });
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(100);
    expect(result.matched.length).toBe(2);
    expect(result.flagged).toContain("aws"); // aws is claimed but not in JD
  });

  it("flags skills that candidate has but are not in JD", () => {
    const result = computeReadinessScore({
      jdText: "React developer needed.",
      candidate: { verified_skills: ["react", "kubernetes", "aws"] },
      evidenceSkills: [],
      resumeSkills: [],
      resumeTextCorpus: "React developer with AWS and Kubernetes.",
    });
    expect(result.flagged).toContain("aws");
    expect(result.flagged).toContain("kubernetes");
    expect(result.matched).toContain("react");
  });

  it("exports default threshold of 70", () => {
    expect(DEFAULT_THRESHOLD).toBe(70);
  });
});