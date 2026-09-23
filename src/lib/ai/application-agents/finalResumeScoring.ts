// src/lib/ai/application-agents/finalResumeScoring.ts
// Deterministic final-score pass, computed AFTER every agent has finished and
// integrity guards have run - on the shipped resume text, never on the
// mid-pipeline draft. No AI call.
//
// Why this exists: Hiring Panel scores the Resume Forge draft, but Final
// Polish may add or drop keywords and the integrity guards may restore base
// content. The numbers persisted on the resume version must describe the
// resume the AE actually sees.

import type { PageFitV1, RequirementAnalysisEntry } from "./schemas";
import { requirementMatchesText } from "./requirementCoverage";
import type { ResumeDocument } from "@/lib/falood/types";
import { normalizeResumeBullet } from "./resumeIntegrity";

export interface FinalResumeScoreInput {
  /** Concatenated searchable text of the FINAL resume (skills + bullets + summary + certifications). */
  finalText: string;
  requirementAnalysis?: RequirementAnalysisEntry[] | null;
  review?: {
    atsScore?: number | null;
    recruiterScore?: number | null;
    roleFitScore?: number | null;
    truthfulnessRisk?: number | null;
    disposition?: string | null;
    passFail?: string | null;
  } | null;
  finalQaScore?: number | null;
  pageFit?: PageFitV1 | null;
  unresolvedWarningCount?: number;
}

export interface FinalResumeScores {
  atsScore: number;
  recruiterScore: number;
  roleFitScore: number;
  truthScore: number;
  /** 0-1 weighted coverage of supported requirements in the final text; null when no classified requirements exist. */
  supportedCoverage: number | null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clamp10(value: number): number {
  return Math.max(0, Math.min(10, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function numOr(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Source of Truth and evidence-bank citations weigh heavier than base-only support (SoT priority). */
function evidenceWeight(entry: RequirementAnalysisEntry): number {
  const cited = entry.sourceEvidence ?? [];
  return cited.some((e) => e.startsWith("sot:") || e.startsWith("evidence:")) ? 1.5 : 1;
}

function isAddableSupported(entry: RequirementAnalysisEntry): boolean {
  return (
    (entry.status === "supported_by_resume" || entry.status === "supported_but_not_surfaced") &&
    (entry.sourceEvidence?.length ?? 0) > 0
  );
}

/**
 * Compute the final published scores for the shipped resume.
 *
 * - atsScore: weighted coverage of classified SUPPORTED requirements in the
 *   final text. SoT-backed requirements weigh 1.5x. Unsupported keywords can
 *   never contribute (and never dock points either). Falls back to the
 *   reviewer's ATS / final QA only when no classified requirements exist.
 * - roleFitScore: reviewer role fit, capped by disposition and hard blockers
 *   (a high ATS can never rescue a role mismatch), minus a bounded penalty for
 *   supported requirements the final resume still fails to surface.
 * - recruiterScore: reviewer recruiter score minus small deterministic
 *   penalties for page overflow, unreadable fonts, and warning pile-up.
 * - truthScore: 10 - truthfulnessRisk (same semantics as before, but computed
 *   here so every published score comes from this one final pass).
 */
export function computeFinalScores(input: FinalResumeScoreInput): FinalResumeScores {
  const analysis = Array.isArray(input.requirementAnalysis) ? input.requirementAnalysis : [];
  const supported = analysis.filter(isAddableSupported);

  let supportedCoverage: number | null = null;
  let atsScore: number;

  if (supported.length > 0) {
    let matchedWeight = 0;
    let totalWeight = 0;
    for (const entry of supported) {
      const weight = evidenceWeight(entry);
      totalWeight += weight;
      if (requirementMatchesText(entry.requirement, input.finalText)) matchedWeight += weight;
    }
    supportedCoverage = totalWeight > 0 ? clamp01(matchedWeight / totalWeight) : 0;
    atsScore = round1(clamp10(supportedCoverage * 10));
  } else {
    atsScore = round1(clamp10(numOr(input.review?.atsScore, numOr(input.finalQaScore, 5))));
  }

  const baseRoleFit = numOr(input.review?.roleFitScore, numOr(input.finalQaScore, 5));
  let roleFitScore = baseRoleFit;
  if (input.review?.disposition === "reject") roleFitScore = Math.min(roleFitScore, 4);
  else if (input.review?.disposition === "deprioritize") roleFitScore = Math.min(roleFitScore, 6);
  if (analysis.some((entry) => entry.status === "hard_blocker")) roleFitScore = Math.min(roleFitScore, 4);
  if (supportedCoverage !== null) {
    roleFitScore -= Math.min(2, (1 - supportedCoverage) * 4);
  }
  roleFitScore = round1(clamp10(roleFitScore));

  let recruiterScore = numOr(input.review?.recruiterScore, numOr(input.finalQaScore, 5));
  if (input.pageFit && (input.pageFit.overflow || !input.pageFit.readable)) recruiterScore -= 1;
  if ((input.unresolvedWarningCount ?? 0) >= 4) recruiterScore -= 0.5;
  recruiterScore = round1(clamp10(recruiterScore));

  const truthfulnessRisk = numOr(input.review?.truthfulnessRisk, 0);
  const truthScore = round1(clamp10(10 - truthfulnessRisk));

  return { atsScore, recruiterScore, roleFitScore, truthScore, supportedCoverage };
}

/**
 * Build the searchable text of a canonical ResumeDocument so coverage
 * matching runs against exactly what the AE sees rendered.
 */
export function resumeDocumentText(doc: ResumeDocument): string {
  const parts: string[] = [];
  if (doc.header?.fullName) parts.push(String(doc.header.fullName));
  if (doc.summary?.text) parts.push(String(doc.summary.text));
  for (const group of doc.skills ?? []) {
    if (group.title) parts.push(String(group.title));
    for (const skill of group.skills ?? []) {
      const text = normalizeResumeBullet(skill);
      if (text) parts.push(text);
    }
  }
  for (const entry of doc.experience ?? []) {
    if (entry.title) parts.push(String(entry.title));
    if (entry.company) parts.push(String(entry.company));
    for (const bullet of entry.bullets ?? []) {
      const text = normalizeResumeBullet(bullet);
      if (text) parts.push(text);
    }
  }
  for (const cert of doc.certifications ?? []) {
    const text = typeof cert === "string" ? cert : (cert as any)?.name;
    if (text) parts.push(String(text));
  }
  for (const edu of doc.education ?? []) {
    if (edu.degree) parts.push(String(edu.degree));
    if (edu.school) parts.push(String(edu.school));
  }
  for (const project of doc.projects ?? []) {
    if (project.name) parts.push(String(project.name));
    if (project.description) parts.push(String(project.description));
    for (const tech of project.technologies ?? []) parts.push(String(tech));
  }
  return parts.join(" ");
}
