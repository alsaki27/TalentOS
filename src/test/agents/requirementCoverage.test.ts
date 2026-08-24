import { describe, it, expect } from "vitest";
import { JobAnalysisSchema } from "@/lib/ai/application-agents/schemas";
import {
  significantTokens,
  requirementMatchesText,
  buildRequirementCoverage,
  listMissedSupported,
  listEvidenceGaps,
} from "@/lib/ai/application-agents/requirementCoverage";

describe("significantTokens", () => {
  it("keeps meaningful words and drops qualifiers", () => {
    expect(significantTokens("5+ years OSP design")).toEqual(["osp", "design"]);
    expect(significantTokens("AutoCAD Civil 3D")).toEqual(["autocad", "civil", "3d"]);
  });

  it("keeps 2-letter all-caps acronyms like PE", () => {
    expect(significantTokens("PE License")).toEqual(["pe", "license"]);
  });
});

describe("requirementMatchesText", () => {
  it("matches on a significant token regardless of extra words", () => {
    expect(requirementMatchesText("AutoCAD", "Designed OSP routes in AutoCAD Civil 3D")).toBe(true);
    expect(requirementMatchesText("5+ years OSP design", "Performed OSP design for fiber networks")).toBe(true);
  });

  it("is case-insensitive and punctuation-tolerant", () => {
    expect(requirementMatchesText("Node.js", "built services with nodejs")).toBe(true);
  });

  it("does not match on qualifier words only", () => {
    expect(requirementMatchesText("5+ years experience", "Managed a team")).toBe(false);
  });

  it("matches empty inputs safely", () => {
    expect(requirementMatchesText("", "anything")).toBe(false);
    expect(requirementMatchesText("React", "")).toBe(false);
  });
});

describe("buildRequirementCoverage", () => {
  const draft = {
    skills: [{ title: "Tools", skills: ["AutoCAD"] }],
    experience: [
      {
        title: "CAD Technician",
        company: "Acme",
        location: null,
        startDate: "2021-01",
        endDate: null,
        bullets: ["Produced splice documentation with ArcGIS Pro"],
        evidenceIds: [],
      },
    ],
  };
  const analysis = {
    requirementAnalysis: [
      { requirement: "AutoCAD", category: "tool", sourceEvidence: ["base.experience[0].bullets[0]"], status: "supported_by_resume", safeToAdd: true },
      { requirement: "ArcGIS Pro", category: "tool", sourceEvidence: ["base.experience[0].bullets[1]"], status: "supported_by_resume", safeToAdd: true },
      { requirement: "Vetro FiberMap", category: "tool", sourceEvidence: ["sot:Vetro FiberMap"], status: "supported_but_not_surfaced", safeToAdd: true },
      { requirement: "PE License", category: "credential", sourceEvidence: [], status: "hard_blocker", safeToAdd: false },
      { requirement: "PMP", category: "cert", sourceEvidence: [], status: "nice_to_have", safeToAdd: false },
    ],
  };

  it("classifies surfaced placements", () => {
    const rows = buildRequirementCoverage(analysis as any, draft as any);
    const byName = Object.fromEntries(rows.map((r) => [r.requirement, r]));
    expect(byName["AutoCAD"].surfaced).toBe(true);
    expect(byName["AutoCAD"].placement).toBe("skills");
    expect(byName["ArcGIS Pro"].surfaced).toBe(true);
    expect(byName["ArcGIS Pro"].placement).toBe("bullet");
  });

  it("marks missed supported as missed_tailoring", () => {
    const rows = buildRequirementCoverage(analysis as any, draft as any);
    const vetro = rows.find((r) => r.requirement === "Vetro FiberMap");
    expect(vetro?.surfaced).toBe(false);
    expect(vetro?.gapReason).toBe("missed_tailoring");
  });

  it("marks unsupported/hard_blocker gaps as candidate evidence gaps", () => {
    const rows = buildRequirementCoverage(analysis as any, draft as any);
    const pe = rows.find((r) => r.requirement === "PE License");
    expect(pe?.surfaced).toBe(false);
    expect(pe?.gapReason).toBe("candidate_evidence_gap");
    expect(rows.find((r) => r.requirement === "PMP")?.gapReason).toBeNull();
  });

  it("listMissedSupported returns only retryable rows", () => {
    const rows = buildRequirementCoverage(analysis as any, draft as any);
    expect(listMissedSupported(rows).map((r) => r.requirement)).toEqual(["Vetro FiberMap"]);
  });

  it("listEvidenceGaps returns only evidence gaps", () => {
    const rows = buildRequirementCoverage(analysis as any, draft as any);
    expect(listEvidenceGaps(rows).map((r) => r.requirement)).toEqual(["PE License"]);
  });

  it("handles missing requirementAnalysis gracefully", () => {
    expect(buildRequirementCoverage(null, draft as any)).toEqual([]);
    expect(buildRequirementCoverage({}, draft as any)).toEqual([]);
  });
});

describe("JobAnalysisSchema requirementAnalysis normalization", () => {
  const base = {
    title: "Engineer",
    company: "Acme",
    requiredSkills: ["AutoCAD"],
  };

  it("parses valid entries and forces safeToAdd rules", () => {
    const result = JobAnalysisSchema.parse({
      ...base,
      requirementAnalysis: [
        { requirement: "AutoCAD", category: "tool", sourceEvidence: ["base.skills[0]"], status: "supported_by_resume", safeToAdd: true },
        { requirement: "Vetro", category: "tool", sourceEvidence: ["sot:Vetro"], status: "supported_but_not_surfaced", safeToAdd: true },
        { requirement: "PE License", category: "credential", sourceEvidence: [], status: "hard_blocker", safeToAdd: true },
        { requirement: "Unsupported Tool", category: "tool", sourceEvidence: [], status: "unsupported", safeToAdd: true },
        { requirement: "No Evidence Claim", category: "skill", sourceEvidence: [], status: "supported_by_resume", safeToAdd: true },
      ],
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    const byName = Object.fromEntries(result.requirementAnalysis.map((r) => [r.requirement, r]));
    expect(byName["AutoCAD"].safeToAdd).toBe(true);
    expect(byName["Vetro"].safeToAdd).toBe(true);
    // Model claims safeToAdd=true, but code is authoritative: these are never addable.
    expect(byName["PE License"].safeToAdd).toBe(false);
    expect(byName["Unsupported Tool"].safeToAdd).toBe(false);
    // Supported but no cited evidence → cannot be treated as safely addable.
    expect(byName["No Evidence Claim"].safeToAdd).toBe(false);
  });

  it("drops rows with invalid statuses instead of failing", () => {
    const result = JobAnalysisSchema.parse({
      ...base,
      requirementAnalysis: [
        { requirement: "AutoCAD", category: "tool", sourceEvidence: ["base.skills[0]"], status: "supported_by_resume" },
        { requirement: "Bogus", category: "tool", sourceEvidence: [], status: "definitely_supported" },
        "not-an-object",
      ],
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.requirementAnalysis.map((r) => r.requirement)).toEqual(["AutoCAD"]);
  });

  it("defaults to empty array when absent", () => {
    const result = JobAnalysisSchema.parse(base);
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.requirementAnalysis).toEqual([]);
  });
});
