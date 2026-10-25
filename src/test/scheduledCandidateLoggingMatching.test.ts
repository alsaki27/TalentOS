import { describe, expect, test } from "vitest";
import {
  provesCitizenshipOf,
  checkStructuredEligibility,
  parseEligibilityResponse,
} from "@/server/services/scheduledCandidateLoggingService";

function job(overrides: Record<string, unknown> = {}) {
  return {
    event_id: "evt-1",
    job_id: "job-1",
    source: "openjobdata",
    ingested_at: "2026-10-20T00:00:00.000Z",
    title: "Electrical Engineer",
    company: "Example Co",
    location: "onsite / United States",
    source_url: null,
    apply_url: null,
    description_text: "Electrical engineer role.",
    raw_description: null,
    posted_at: "2026-10-20T00:00:00.000Z",
    seniority_level: null,
    job_category: null,
    is_active: true,
    requires_citizenship: false,
    citizenship_countries: null,
    export_control_restricted: false,
    eligibility_restriction_evidence: null,
    ...overrides,
  } as any;
}

function candidate(preferences: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) {
  return {
    id: "cand-1",
    name: "Test Candidate",
    status: "active",
    pipeline_stage: "applying",
    work_authorization: null,
    visa_status: null,
    preferred_locations: null,
    priority: "default",
    preferences,
    custom_requirements: "",
    ...overrides,
  } as any;
}

describe("provesCitizenshipOf", () => {
  test("US Citizen proves United States citizenship", () => {
    expect(provesCitizenshipOf("US Citizen", "United States")).toBe(true);
  });

  test("Green Card holder does not prove citizenship", () => {
    expect(provesCitizenshipOf("Green Card holder", "United States")).toBe(false);
  });

  test("F1 OPT with EAD does not prove citizenship", () => {
    expect(provesCitizenshipOf("F1 OPT with EAD", "United States")).toBe(false);
  });

  test("Canadian citizen proves Canada citizenship", () => {
    expect(provesCitizenshipOf("Canadian citizen", "Canada")).toBe(true);
  });

  test("empty status proves nothing", () => {
    expect(provesCitizenshipOf("", "United States")).toBe(false);
  });

  test("generic country name uses the fallback pattern", () => {
    expect(provesCitizenshipOf("United Kingdom citizen", "United Kingdom")).toBe(true);
  });
});

describe("checkStructuredEligibility", () => {
  test("no gate when job has no restrictions", () => {
    expect(checkStructuredEligibility(job(), candidate())).toEqual([]);
  });

  test("citizenship required, no recorded status -> gated", () => {
    const gates = checkStructuredEligibility(
      job({ requires_citizenship: true, citizenship_countries: ["United States"] }),
      candidate(),
    );
    expect(gates).toHaveLength(1);
    expect(gates[0]).toMatch(/no citizenship status is recorded/);
  });

  test("citizenship required, recorded status proves it -> no gate", () => {
    const gates = checkStructuredEligibility(
      job({ requires_citizenship: true, citizenship_countries: ["United States"] }),
      candidate({ citizenshipStatus: "US Citizen" }),
    );
    expect(gates).toEqual([]);
  });

  test("citizenship required, recorded status does NOT prove it (Green Card) -> still gated", () => {
    const gates = checkStructuredEligibility(
      job({ requires_citizenship: true, citizenship_countries: ["United States"] }),
      candidate({ citizenshipStatus: "Green Card holder" }),
    );
    expect(gates).toHaveLength(1);
    expect(gates[0]).toMatch(/does not prove required citizenship/);
  });

  test("export-control/clearance required, no recorded clearance -> gated", () => {
    const gates = checkStructuredEligibility(
      job({ export_control_restricted: true }),
      candidate(),
    );
    expect(gates).toHaveLength(1);
    expect(gates[0]).toMatch(/no security clearance is recorded/);
  });

  test("export-control/clearance required, recorded clearance -> no gate from this function", () => {
    const gates = checkStructuredEligibility(
      job({ export_control_restricted: true }),
      candidate({ securityClearance: "Active Secret" }),
    );
    expect(gates).toEqual([]);
  });

  test("both citizenship and clearance unresolved -> two gates", () => {
    const gates = checkStructuredEligibility(
      job({ requires_citizenship: true, citizenship_countries: ["United States"], export_control_restricted: true }),
      candidate(),
    );
    expect(gates).toHaveLength(2);
  });
});

describe("parseEligibilityResponse", () => {
  test("parses valid JSON", () => {
    const result = parseEligibilityResponse(JSON.stringify({ score: 92, reason: "Strong fit", hard_gates: [] }));
    expect(result).toEqual({ score: 92, reason: "Strong fit", hardGates: [] });
  });

  test("parses markdown-fenced JSON", () => {
    const result = parseEligibilityResponse("```json\n" + JSON.stringify({ score: 70, reason: "ok", hard_gates: ["x"] }) + "\n```");
    expect(result.score).toBe(70);
    expect(result.hardGates).toEqual(["x"]);
  });

  test("unparsable JSON throws an invalid-model-output message", () => {
    expect(() => parseEligibilityResponse("not json")).toThrow(/invalid model output/);
  });

  test("out-of-range score throws an invalid-model-output message", () => {
    expect(() => parseEligibilityResponse(JSON.stringify({ score: 150, reason: "x", hard_gates: [] })))
      .toThrow(/invalid model output/);
  });

  test("missing reason defaults to a fallback string", () => {
    const result = parseEligibilityResponse(JSON.stringify({ score: 50, hard_gates: [] }));
    expect(result.reason).toBe("No explanation returned.");
  });
});
