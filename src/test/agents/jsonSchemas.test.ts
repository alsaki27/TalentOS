// Round-trip test for jsonSchemas.ts: asserts a handful of golden objects
// validate identically through both the hand-written JSON Schema (sent to
// Vertex as a structured-output constraint) and the existing hand-written
// parser in schemas.ts (the runtime source of truth). The two are
// deliberately separate implementations - this test is what stops them
// silently drifting apart as either one changes.

import { describe, it, expect } from "vitest";
import { ResumeDraftSchema, ReviewScoreSchema, FinalResumeSchema } from "@/lib/ai/application-agents/schemas";
import { RESUME_DRAFT_JSON_SCHEMA, REVIEW_SCORE_JSON_SCHEMA, FINAL_RESUME_JSON_SCHEMA } from "@/lib/ai/application-agents/jsonSchemas";

// A minimal validator for the JSON Schema subset jsonSchemas.ts actually
// uses (type incl. nullable via a type array, properties/required,
// additionalProperties: false, array items, enum) - intentionally not a
// general-purpose library. schemas.ts's own header explains why this
// codebase writes validation by hand rather than adding a dependency
// (originally to avoid Zod); the same reasoning applies to ajv here, and
// this test only needs to catch shape drift, not implement JSON Schema in
// full.
function validateAgainstSchema(value: unknown, schema: any, path = "$"): string[] {
  const errors: string[] = [];
  const types: string[] = Array.isArray(schema.type) ? schema.type : [schema.type];

  const actualType = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (!types.includes(actualType)) {
    errors.push(`${path}: expected type ${types.join("|")}, got ${actualType}`);
    return errors;
  }
  if (actualType === "null") return errors;

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: value ${JSON.stringify(value)} not in enum ${JSON.stringify(schema.enum)}`);
  }

  if (actualType === "object" && schema.properties) {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in obj)) errors.push(`${path}.${key}: required but missing`);
    }
    for (const key of Object.keys(obj)) {
      if (schema.additionalProperties === false && !(key in schema.properties)) {
        errors.push(`${path}.${key}: additional property not allowed`);
        continue;
      }
      if (schema.properties[key]) {
        errors.push(...validateAgainstSchema(obj[key], schema.properties[key], `${path}.${key}`));
      }
    }
  }

  if (actualType === "array" && schema.items) {
    (value as unknown[]).forEach((item, i) => {
      errors.push(...validateAgainstSchema(item, schema.items, `${path}[${i}]`));
    });
  }

  return errors;
}

describe("jsonSchemas round-trip - stays in sync with schemas.ts", () => {
  it("ResumeDraftV1: a golden object parses via schemas.ts AND validates against the JSON Schema", () => {
    const golden = {
      summary: "Experienced GIS analyst.",
      skills: [{ title: "GIS Software", skills: ["ArcGIS Pro", "QGIS"] }],
      experience: [{
        title: "GIS Technician", company: "Acme", location: "Tampa, FL",
        startDate: "2024-01", endDate: null, bullets: ["Managed 500+ records"], evidenceIds: ["ev-1"],
      }],
      education: [{ degree: "B.S. Geography", school: "State U", field: null, graduationDate: "2023" }],
      certifications: ["GISP"],
      projects: [{ name: "Indoor mapping", description: "Built a wayfinding system", technologies: ["ArcGIS Indoors"] }],
      changeLog: [{ change: "Added ArcGIS Indoors", reason: "JD requires it", evidenceId: "ev-1" }],
      missingRequirements: ["5 years experience"],
      excludedKeywords: ["synergy"],
      truthRisks: [{ risk: "None identified", severity: "low" as const }],
    };

    const parsed = ResumeDraftSchema.parse(golden);
    expect(parsed).not.toHaveProperty("error");

    const schemaErrors = validateAgainstSchema(golden, RESUME_DRAFT_JSON_SCHEMA);
    expect(schemaErrors).toEqual([]);
  });

  it("ReviewScoreV1: a golden object parses via schemas.ts AND validates against the JSON Schema", () => {
    const golden = {
      atsScore: 8, recruiterScore: 7, roleFitScore: 6, truthfulnessRisk: 0,
      formattingIssues: ["Bottom whitespace slightly high"],
      requiredEdits: [{ issueId: "r1", description: "Trim second bullet", severity: "minor" as const }],
      optionalEdits: [{ issueId: "o1", description: "Consider adding a summary" }],
      passFail: "pass" as const,
      disposition: "pursue" as const,
      dispositionReasons: [],
      overallComment: "Strong match overall.",
    };

    const parsed = ReviewScoreSchema.parse(golden);
    expect(parsed).not.toHaveProperty("error");

    const schemaErrors = validateAgainstSchema(golden, REVIEW_SCORE_JSON_SCHEMA);
    expect(schemaErrors).toEqual([]);
  });

  it("FinalResumeV1: a golden object parses via schemas.ts AND validates against the JSON Schema", () => {
    const golden = {
      summary: "Final tailored summary.",
      skills: [{ title: "GIS Software", skills: ["ArcGIS Pro"] }],
      experience: [{
        title: "GIS Technician", company: "Acme", location: "Tampa, FL",
        startDate: null, endDate: null, bullets: ["Managed 500+ records"], evidenceIds: [],
      }],
      education: [{ degree: "B.S. Geography", school: "State U", field: null, graduationDate: "2023" }],
      certifications: [],
      projects: [],
      appliedIssueIds: ["r1"],
      rejectedIssueIds: [{ issueId: "r2", reason: "Not applicable" }],
      unresolvedWarnings: [],
      finalQaScore: 9.2,
      exportReady: true,
    };

    const parsed = FinalResumeSchema.parse(golden);
    expect(parsed).not.toHaveProperty("error");

    const schemaErrors = validateAgainstSchema(golden, FINAL_RESUME_JSON_SCHEMA);
    expect(schemaErrors).toEqual([]);
  });

  it("catches a real drift: an object missing a JSON-Schema-required field fails the JSON Schema check even though schemas.ts's lenient parser accepts it", () => {
    // schemas.ts defaults a missing `certifications` to [] - a real, deliberate
    // leniency for older data. The JSON Schema sent to the model must NOT be
    // that lenient (strict mode requires every key present), so this exact
    // divergence is expected and this test documents it rather than treating
    // it as a bug to fix.
    const missingCertifications = {
      summary: null, skills: [], experience: [], education: [],
      projects: [], changeLog: [], missingRequirements: [], excludedKeywords: [], truthRisks: [],
    };
    const parsed = ResumeDraftSchema.parse(missingCertifications);
    expect(parsed).not.toHaveProperty("error");

    const schemaErrors = validateAgainstSchema(missingCertifications, RESUME_DRAFT_JSON_SCHEMA);
    expect(schemaErrors.length).toBeGreaterThan(0);
    expect(schemaErrors[0]).toMatch(/certifications/);
  });
});
