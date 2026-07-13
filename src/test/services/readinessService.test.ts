// src/test/services/readinessService.test.ts
// Ported from talentOS-B readiness-engine/test/readiness.test.ts
// Adapted from node:test/assert to vitest

import { describe, it, expect } from "vitest";
import { computeReadinessScore, DEFAULT_THRESHOLD } from "@/server/services/readinessService";

const VOCABULARY = [
  "react", "typescript", "node.js", "sql", "git", "kubernetes",
  "python", "docker", "aws", "graphql", "java", "c#", "go", "rust",
  "terraform", "jenkins", "css", "html", "javascript", "mongodb",
  "postgresql", "redis", "kafka", "ci/cd",
];

describe("computeReadinessScore", () => {
  it("returns 50 when no required skills match vocabulary", () => {
    const result = computeReadinessScore({
      jdText: "This job requires excellent communication skills.",
      evidencedSkills: [],
      claimedSkills: [],
      knownSkillVocabulary: VOCABULARY,
    });
    expect(result.score).toBe(50);
    expect(result.required).toEqual([]);
    expect(result.matched).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.flagged).toEqual([]);
  });

  it("computes perfect score when all required skills are evidenced", () => {
    const result = computeReadinessScore({
      jdText: "Must know React, TypeScript, and Node.js. SQL experience required.",
      evidencedSkills: ["react", "typescript", "node.js", "sql"],
      claimedSkills: ["react", "typescript", "node.js", "sql"],
      knownSkillVocabulary: VOCABULARY,
    });
    expect(result.score).toBe(100);
    expect(result.required.sort()).toEqual(["node.js", "react", "sql", "typescript"].sort());
    expect(result.matched.sort()).toEqual(["node.js", "react", "sql", "typescript"].sort());
    expect(result.missing).toEqual([]);
    expect(result.flagged).toEqual([]);
  });

  it("computes partial score", () => {
    const result = computeReadinessScore({
      jdText: "React TypeScript Node.js SQL Git required.",
      evidencedSkills: ["react", "typescript"],
      claimedSkills: ["react", "typescript", "node.js"],
      knownSkillVocabulary: VOCABULARY,
    });
    expect(result.score).toBe(40);
    expect(result.required.length).toBe(5);
    expect(result.matched.length).toBe(2);
    expect(result.missing.length).toBe(3);
    expect(result.flagged.length).toBe(1);
  });

  it("incident fixture scores below threshold", () => {
    const result = computeReadinessScore({
      jdText: "We need React, TypeScript, Node.js, SQL, Git, Kubernetes, Docker, AWS, Terraform, and CI/CD experience.",
      evidencedSkills: ["react", "typescript", "node.js", "sql", "git"],
      claimedSkills: ["react", "typescript", "node.js", "sql", "git", "kubernetes"],
      knownSkillVocabulary: VOCABULARY,
    });
    expect(result.score).toBeLessThan(70);
    expect(result.flagged).toContain("kubernetes");
    expect(result.required.length).toBe(10);
    expect(result.matched.length).toBe(5);
    expect(result.missing.length).toBe(5);
  });

  it("normalizes skill names (case, special chars)", () => {
    const result = computeReadinessScore({
      jdText: "Node.JS and TypeScript needed!",
      evidencedSkills: ["Node.js", "TypeScript"],
      claimedSkills: [],
      knownSkillVocabulary: ["node.js", "typescript"],
    });
    expect(result.score).toBe(100);
    expect(result.matched.length).toBe(2);
  });

  it("flagged skills are claimed minus evidenced regardless of JD", () => {
    const result = computeReadinessScore({
      jdText: "React developer needed.",
      evidencedSkills: ["react"],
      claimedSkills: ["react", "kubernetes", "aws"],
      knownSkillVocabulary: VOCABULARY,
    });
    expect(result.flagged.sort()).toEqual(["aws", "kubernetes"]);
  });

  it("exports default threshold of 70", () => {
    expect(DEFAULT_THRESHOLD).toBe(70);
  });
});