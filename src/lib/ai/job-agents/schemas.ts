import type { Schema } from "@/lib/ai/application-agents/schemas";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function expectString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function expectNumber(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

function expectStringArray(v: unknown): string[] | null {
  return Array.isArray(v) && v.every(function (x) { return typeof x === "string"; }) ? v : null;
}

export interface ScoutTermsV1 {
  queries: string[];
  booleanStrings: string[];
  rationale: string;
}

export const ScoutTermsSchema: Schema<ScoutTermsV1> = {
  parse: function (input: unknown): ScoutTermsV1 | { error: string } {
    if (!isRecord(input)) return { error: "ScoutTermsV1 must be an object" };
    var queries = expectStringArray(input.queries) ?? [];
    var booleanStrings = expectStringArray(input.booleanStrings) ?? [];
    var rationale = expectString(input.rationale) ?? "";
    return { queries: queries, booleanStrings: booleanStrings, rationale: rationale };
  },
};

export interface QaVerdictV1 {
  keep: boolean;
  score: number;
  tier: "best" | "medium" | "worthy" | "skip";
  reason: string;
}

export const QaVerdictSchema: Schema<QaVerdictV1> = {
  parse: function (input: unknown): QaVerdictV1 | { error: string } {
    if (!isRecord(input)) return { error: "QaVerdictV1 must be an object" };
    var keep = !!input.keep;
    var score = expectNumber(input.score) ?? 0;
    var tier = expectString(input.tier) ?? "skip";
    var reason = expectString(input.reason) ?? "";
    var validTiers = ["best", "medium", "worthy", "skip"];
    if (validTiers.indexOf(tier) === -1) {
      return { error: "tier must be one of best/medium/worthy/skip, got " + tier };
    }
    return { keep: keep, score: score, tier: tier as QaVerdictV1["tier"], reason: reason };
  },
};

export interface DeepFetchResultV1 {
  descriptionText: string;
  requirements: {
    yearsExperience: string | null;
    techStack: string[];
    clearance: string | null;
    certifications: string[];
  };
}

export const DeepFetchResultSchema: Schema<DeepFetchResultV1> = {
  parse: function (input: unknown): DeepFetchResultV1 | { error: string } {
    if (!isRecord(input)) return { error: "DeepFetchResultV1 must be an object" };
    var descriptionText = expectString(input.descriptionText) ?? "";
    var requirements = isRecord(input.requirements) ? input.requirements : {};
    return {
      descriptionText: descriptionText,
      requirements: {
        yearsExperience: expectString(requirements.yearsExperience),
        techStack: Array.isArray(requirements.techStack) ? requirements.techStack.filter(function (s: unknown): s is string { return typeof s === "string"; }) : [],
        clearance: expectString(requirements.clearance),
        certifications: Array.isArray(requirements.certifications) ? requirements.certifications.filter(function (s: unknown): s is string { return typeof s === "string"; }) : [],
      },
    };
  },
};

export interface MatchmakerResultV1 {
  matches: {
    candidateId: string;
    score: number;
    reasons: string[];
    outreachDraft: string;
  }[];
}

export const MatchmakerResultSchema: Schema<MatchmakerResultV1> = {
  parse: function (input: unknown): MatchmakerResultV1 | { error: string } {
    if (!isRecord(input)) return { error: "MatchmakerResultV1 must be an object" };
    if (!Array.isArray(input.matches)) return { error: "matches must be an array" };
    var matches: MatchmakerResultV1["matches"] = [];
    for (var i = 0; i < input.matches.length; i++) {
      var m = input.matches[i];
      if (!isRecord(m)) continue;
      if (typeof m.candidateId !== "string") continue;
      matches.push({
        candidateId: m.candidateId,
        score: typeof m.score === "number" ? m.score : 0,
        reasons: Array.isArray(m.reasons) ? m.reasons.filter(function (r: unknown): r is string { return typeof r === "string"; }) : [],
        outreachDraft: typeof m.outreachDraft === "string" ? m.outreachDraft : "",
      });
    }
    return { matches: matches };
  },
};

export interface CeoPlanV1 {
  stages: string[];
  notes: string;
  proposals: {
    targetAutomationId: string;
    proposedChanges: Record<string, unknown>;
    rationale: string;
  }[];
}

export const CeoPlanSchema: Schema<CeoPlanV1> = {
  parse: function (input: unknown): CeoPlanV1 | { error: string } {
    if (!isRecord(input)) return { error: "CeoPlanV1 must be an object" };
    var stages = expectStringArray(input.stages) ?? [];
    var notes = expectString(input.notes) ?? "";
    var proposals: CeoPlanV1["proposals"] = [];
    if (Array.isArray(input.proposals)) {
      for (var i = 0; i < input.proposals.length; i++) {
        var p = input.proposals[i];
        if (!isRecord(p)) continue;
        if (typeof p.targetAutomationId !== "string") continue;
        proposals.push({
          targetAutomationId: p.targetAutomationId,
          proposedChanges: isRecord(p.proposedChanges) ? p.proposedChanges : {},
          rationale: typeof p.rationale === "string" ? p.rationale : "",
        });
      }
    }
    return { stages: stages, notes: notes, proposals: proposals };
  },
};

export var SCHEMA_VERSIONS: Record<string, string> = {
  scoutTerms: "ScoutTermsV1",
  qaVerdict: "QaVerdictV1",
  deepFetchResult: "DeepFetchResultV1",
  matchmakerResult: "MatchmakerResultV1",
  ceoPlan: "CeoPlanV1",
};
