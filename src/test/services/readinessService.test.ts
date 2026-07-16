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
    const result = computeReadinessScore({
      jdText: "Must know React, TypeScript, and Node.js. SQL experience required.",
      candidate: { verified_skills: ["react", "typescript"] },
      evidenceSkills: ["node.js", "sql"],
      resumeSkills: ["react", "sql"],
      resumeTextCorpus: "I have worked with React and TypeScript extensively, as well as Node.js and SQL.",
    });
    // High skill match and high density should yield a high score
    expect(result.score).toBeGreaterThan(80);
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