// Hand-written JSON Schemas for the three stages whose output shape is
// complex enough that structured-output constraints (Gemini's
// response_mime_type + response_schema, wired through
// googleVertexProxyProvider.ts as an OpenAI-style json_schema/strict
// response_format) measurably cut malformed-JSON retries. Only
// googleVertexProxyProvider.ts reads AiProvider.send()'s optional
// responseSchema/responseMimeType fields - every other provider destructures
// only the fields it uses, so passing these everywhere is a safe no-op for
// them (confirmed by reading every provider file, not assumed).
//
// These are deliberately separate from schemas.ts's hand-written parser, not
// generated from it: the parser stays lenient (accepts legacy shapes like a
// flat skills string[], tolerates missing optional fields) because it must
// keep validating older stored data and any provider that ignores the
// schema. This file instead describes the single canonical shape we actually
// want the model to produce going forward. jsonSchemas.test.ts's round-trip
// test is what keeps the two from silently drifting apart - it asserts a
// handful of golden objects parse identically through both.
//
// Fields the LLM never authors (ResumeDraftV1.requirementCoverage,
// ReviewScoreV1.pageFit, FinalResumeV1.pageFit - schemas.ts always parses
// these from the model's own JSON as null/[] and a separate deterministic
// step overwrites them after validation) are intentionally absent here -
// asking the model to produce a field that's discarded anyway just adds
// tokens and a chance for the model to fill it with something misleading.
//
// Written to the subset OpenAI/Vertex's "strict" structured-output mode
// requires: every property key listed in `required` (a field that's
// genuinely optional in schemas.ts's parser is modelled here as `["type",
// "null"]` instead of an absent key - strict mode does not support absent
// optional keys), and `additionalProperties: false` on every object,
// including nested ones.

type JsonSchema = Record<string, unknown>;

const nullableString: JsonSchema = { type: ["string", "null"] };

const skillGroupSchema: JsonSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    skills: { type: "array", items: { type: "string" } },
  },
  required: ["title", "skills"],
  additionalProperties: false,
};

const experienceEntrySchema: JsonSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    company: { type: "string" },
    location: nullableString,
    startDate: nullableString,
    endDate: nullableString,
    bullets: { type: "array", items: { type: "string" } },
    evidenceIds: { type: "array", items: { type: "string" } },
  },
  required: ["title", "company", "location", "startDate", "endDate", "bullets", "evidenceIds"],
  additionalProperties: false,
};

const educationEntrySchema: JsonSchema = {
  type: "object",
  properties: {
    degree: { type: "string" },
    school: { type: "string" },
    field: nullableString,
    graduationDate: nullableString,
  },
  required: ["degree", "school", "field", "graduationDate"],
  additionalProperties: false,
};

const projectEntrySchema: JsonSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    technologies: { type: "array", items: { type: "string" } },
  },
  required: ["name", "description", "technologies"],
  additionalProperties: false,
};

export const RESUME_DRAFT_JSON_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    summary: nullableString,
    skills: { type: "array", items: skillGroupSchema },
    experience: { type: "array", items: experienceEntrySchema },
    education: { type: "array", items: educationEntrySchema },
    certifications: { type: "array", items: { type: "string" } },
    projects: { type: "array", items: projectEntrySchema },
    changeLog: {
      type: "array",
      items: {
        type: "object",
        properties: { change: { type: "string" }, reason: { type: "string" }, evidenceId: nullableString },
        required: ["change", "reason", "evidenceId"],
        additionalProperties: false,
      },
    },
    missingRequirements: { type: "array", items: { type: "string" } },
    excludedKeywords: { type: "array", items: { type: "string" } },
    truthRisks: {
      type: "array",
      items: {
        type: "object",
        properties: { risk: { type: "string" }, severity: { type: "string", enum: ["low", "medium", "high"] } },
        required: ["risk", "severity"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "skills", "experience", "education", "certifications", "projects", "changeLog", "missingRequirements", "excludedKeywords", "truthRisks"],
  additionalProperties: false,
};

export const REVIEW_SCORE_JSON_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    atsScore: { type: "number" },
    recruiterScore: { type: "number" },
    roleFitScore: { type: "number" },
    truthfulnessRisk: { type: "number" },
    formattingIssues: { type: "array", items: { type: "string" } },
    requiredEdits: {
      type: "array",
      items: {
        type: "object",
        properties: {
          issueId: { type: "string" },
          description: { type: "string" },
          severity: { type: "string", enum: ["minor", "major", "critical"] },
        },
        required: ["issueId", "description", "severity"],
        additionalProperties: false,
      },
    },
    optionalEdits: {
      type: "array",
      items: {
        type: "object",
        properties: { issueId: { type: "string" }, description: { type: "string" } },
        required: ["issueId", "description"],
        additionalProperties: false,
      },
    },
    passFail: { type: "string", enum: ["pass", "fail", "review"] },
    disposition: { type: "string", enum: ["pursue", "review", "deprioritize", "reject"] },
    dispositionReasons: { type: "array", items: { type: "string" } },
    overallComment: { type: "string" },
  },
  required: ["atsScore", "recruiterScore", "roleFitScore", "truthfulnessRisk", "formattingIssues", "requiredEdits", "optionalEdits", "passFail", "disposition", "dispositionReasons", "overallComment"],
  additionalProperties: false,
};

export const FINAL_RESUME_JSON_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    summary: nullableString,
    skills: { type: "array", items: skillGroupSchema },
    experience: { type: "array", items: experienceEntrySchema },
    education: { type: "array", items: educationEntrySchema },
    certifications: { type: "array", items: { type: "string" } },
    projects: { type: "array", items: projectEntrySchema },
    appliedIssueIds: { type: "array", items: { type: "string" } },
    rejectedIssueIds: {
      type: "array",
      items: {
        type: "object",
        properties: { issueId: { type: "string" }, reason: { type: "string" } },
        required: ["issueId", "reason"],
        additionalProperties: false,
      },
    },
    unresolvedWarnings: { type: "array", items: { type: "string" } },
    finalQaScore: { type: "number" },
    exportReady: { type: "boolean" },
  },
  required: ["summary", "skills", "experience", "education", "certifications", "projects", "appliedIssueIds", "rejectedIssueIds", "unresolvedWarnings", "finalQaScore", "exportReady"],
  additionalProperties: false,
};
