// src/server/services/evidenceMappingService.ts
// Conservative evidence mapping for application keywords.
// Deterministic first: scans candidate profile, evidence bank, resumes, base resumes.
// AI-assisted only if provider is available and failure degrades cleanly.
// NEVER invents experience. If evidence is not found, marks missing.

import { supabase } from "@/lib/supabase";
import { getActiveProviderAsync } from "@/lib/ai";
import { textOf } from "@/lib/ai/provider";
import {
  ApplicationKeywordRow,
  UpdateApplicationKeywordInput,
  updateApplicationKeyword,
} from "@/server/repositories/applicationKeywordsRepository";

export interface EvidenceMappingResult {
  keywordId: string;
  evidenceStatus: "mapped" | "weak" | "missing" | "unmapped";
  evidenceSummary: string;
  confidence: number;
}

interface CandidateEvidenceSource {
  profileText: string;
  evidenceSkills: string[];
  evidenceTitles: string[];
  evidenceDescriptions: string[];
  resumeSkills: string[];
  resumeExperience: string[];
  baseResumeSkills: string[];
  baseResumeExperience: string[];
}

// ───────────────────────────────────────────────────────────────
// Public entry point
// ───────────────────────────────────────────────────────────────

export async function mapEvidenceForApplication(
  applicationId: string,
  candidateId: string
): Promise<EvidenceMappingResult[]> {
  const { data: keywords } = await supabase
    .from("application_job_keywords")
    .select("*")
    .eq("application_id", applicationId);

  if (!keywords || keywords.length === 0) return [];

  const source = await gatherCandidateEvidenceSources(candidateId);
  const results: EvidenceMappingResult[] = [];

  for (const kw of keywords as ApplicationKeywordRow[]) {
    const result = mapSingleKeyword(kw, source);
    results.push(result);

    // Persist mapping result back to keyword row
    await updateApplicationKeyword(kw.id, {
      evidence_status: result.evidenceStatus,
      evidence_summary: result.evidenceSummary,
    });
  }

  return results;
}

export async function mapEvidenceForKeyword(
  keyword: ApplicationKeywordRow,
  candidateId: string
): Promise<EvidenceMappingResult> {
  const source = await gatherCandidateEvidenceSources(candidateId);
  return mapSingleKeyword(keyword, source);
}

// ───────────────────────────────────────────────────────────────
// Gather all candidate evidence sources
// ───────────────────────────────────────────────────────────────

async function gatherCandidateEvidenceSources(candidateId: string): Promise<CandidateEvidenceSource> {
  // Parallel fetch of all evidence sources
  const [
    candidateRes,
    evidenceRes,
    resumeRes,
    baseResumeRes,
  ] = await Promise.all([
    supabase
      .from("candidates")
      .select("target_roles, target_industries, work_authorization, visa_status, notes, skills")
      .eq("id", candidateId)
      .single(),
    supabase
      .from("candidate_evidence")
      .select("title, description, related_skills")
      .eq("candidate_id", candidateId),
    supabase
      .from("resumes")
      .select("parsed_json")
      .eq("candidate_id", candidateId)
      .eq("is_original_upload", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("base_resumes")
      .select("content")
      .eq("candidate_id", candidateId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const candidate = candidateRes.data ?? {};

  // Extract evidence skills
  const evidenceSkills: string[] = [];
  const evidenceTitles: string[] = [];
  const evidenceDescriptions: string[] = [];
  for (const ev of (evidenceRes.data ?? []) as any[]) {
    if (ev.related_skills) evidenceSkills.push(...ev.related_skills);
    if (ev.title) evidenceTitles.push(ev.title);
    if (ev.description) evidenceDescriptions.push(ev.description);
  }

  // Extract resume skills from parsed_json
  const resumeSkills: string[] = [];
  const resumeExperience: string[] = [];
  const parsed = resumeRes.data?.parsed_json as Record<string, unknown> | null;
  if (parsed) {
    if (Array.isArray(parsed.skills)) {
      for (const s of parsed.skills) {
        if (typeof s === "string") resumeSkills.push(s);
        else if (typeof s === "object" && s && "name" in s) resumeSkills.push((s as any).name);
      }
    }
    if (Array.isArray(parsed.experience)) {
      for (const exp of parsed.experience) {
        if (typeof exp === "object" && exp) {
          if (exp.title) resumeExperience.push(exp.title);
          if (exp.company) resumeExperience.push(exp.company);
          if (exp.description) resumeExperience.push(exp.description);
          if (Array.isArray(exp.bullets)) {
            for (const b of exp.bullets) {
              if (typeof b === "string") resumeExperience.push(b);
              else if (typeof b === "object" && b && b.text) resumeExperience.push(b.text);
            }
          }
        }
      }
    }
  }

  // Extract base resume skills
  const baseResumeSkills: string[] = [];
  const baseResumeExperience: string[] = [];
  const baseContent = baseResumeRes.data?.content as Record<string, unknown> | null;
  if (baseContent) {
    if (Array.isArray(baseContent.skills)) {
      for (const s of baseContent.skills) {
        if (typeof s === "object" && s) {
          if (s.title) baseResumeSkills.push(s.title);
          if (Array.isArray(s.skills)) baseResumeSkills.push(...s.skills.filter((x: any) => typeof x === "string"));
        }
      }
    }
    if (Array.isArray(baseContent.experience)) {
      for (const exp of baseContent.experience) {
        if (typeof exp === "object" && exp) {
          if (exp.title) baseResumeExperience.push(exp.title);
          if (exp.company) baseResumeExperience.push(exp.company);
          if (Array.isArray(exp.bullets)) {
            for (const b of exp.bullets) {
              if (typeof b === "object" && b && b.text) baseResumeExperience.push(b.text);
            }
          }
        }
      }
    }
  }

  // Build profile text for fuzzy matching
  const profileParts: string[] = [];
  if (candidate.target_roles) profileParts.push(candidate.target_roles);
  if (candidate.target_industries) profileParts.push(candidate.target_industries.join(" "));
  if (candidate.work_authorization) profileParts.push(candidate.work_authorization);
  if (candidate.visa_status) profileParts.push(candidate.visa_status);
  if (candidate.notes) profileParts.push(candidate.notes);
  if (candidate.skills) profileParts.push(candidate.skills);

  return {
    profileText: profileParts.join(" ").toLowerCase(),
    evidenceSkills: evidenceSkills.map((s) => s.toLowerCase()),
    evidenceTitles: evidenceTitles.map((s) => s.toLowerCase()),
    evidenceDescriptions: evidenceDescriptions.map((s) => s.toLowerCase()),
    resumeSkills: resumeSkills.map((s) => s.toLowerCase()),
    resumeExperience: resumeExperience.map((s) => s.toLowerCase()),
    baseResumeSkills: baseResumeSkills.map((s) => s.toLowerCase()),
    baseResumeExperience: baseResumeExperience.map((s) => s.toLowerCase()),
  };
}

// ───────────────────────────────────────────────────────────────
// Map a single keyword
// ───────────────────────────────────────────────────────────────

function mapSingleKeyword(
  keyword: ApplicationKeywordRow,
  source: CandidateEvidenceSource
): EvidenceMappingResult {
  const kwNorm = keyword.keyword.toLowerCase();
  const kwWords = kwNorm.split(/\s+/);

  // Direct match in evidence skills (strongest signal)
  for (const skill of source.evidenceSkills) {
    if (skill === kwNorm || skill.includes(kwNorm) || kwNorm.includes(skill)) {
      return {
        keywordId: keyword.id,
        evidenceStatus: "mapped",
        evidenceSummary: `Found in evidence bank: "${skill}"`,
        confidence: 0.95,
      };
    }
  }

  // Match in evidence titles
  for (const title of source.evidenceTitles) {
    if (title.includes(kwNorm) || kwNorm.includes(title)) {
      return {
        keywordId: keyword.id,
        evidenceStatus: "mapped",
        evidenceSummary: `Found in evidence title: "${title}"`,
        confidence: 0.9,
      };
    }
  }

  // Match in resume skills
  for (const skill of source.resumeSkills) {
    if (skill === kwNorm || skill.includes(kwNorm) || kwNorm.includes(skill)) {
      return {
        keywordId: keyword.id,
        evidenceStatus: "mapped",
        evidenceSummary: `Found in uploaded resume skills: "${skill}"`,
        confidence: 0.88,
      };
    }
  }

  // Match in base resume skills
  for (const skill of source.baseResumeSkills) {
    if (skill === kwNorm || skill.includes(kwNorm) || kwNorm.includes(skill)) {
      return {
        keywordId: keyword.id,
        evidenceStatus: "mapped",
        evidenceSummary: `Found in base resume skills: "${skill}"`,
        confidence: 0.85,
      };
    }
  }

  // Match in resume experience bullets
  for (const exp of source.resumeExperience) {
    if (exp.includes(kwNorm)) {
      return {
        keywordId: keyword.id,
        evidenceStatus: "weak",
        evidenceSummary: `Mentioned in resume experience but not as a direct skill claim`,
        confidence: 0.6,
      };
    }
  }

  // Match in base resume experience
  for (const exp of source.baseResumeExperience) {
    if (exp.includes(kwNorm)) {
      return {
        keywordId: keyword.id,
        evidenceStatus: "weak",
        evidenceSummary: `Mentioned in base resume experience but not as a direct skill claim`,
        confidence: 0.55,
      };
    }
  }

  // Match in profile text
  if (source.profileText.includes(kwNorm)) {
    return {
      keywordId: keyword.id,
      evidenceStatus: "weak",
      evidenceSummary: `Mentioned in candidate profile but not in structured resume or evidence`,
      confidence: 0.5,
    };
  }

  // Partial word match for multi-word keywords
  if (kwWords.length > 1) {
    let matchedWords = 0;
    const allText = [
      ...source.evidenceSkills,
      ...source.resumeSkills,
      ...source.baseResumeSkills,
      ...source.resumeExperience,
      ...source.baseResumeExperience,
      source.profileText,
    ].join(" ");
    for (const word of kwWords) {
      if (allText.includes(word)) matchedWords++;
    }
    const matchRatio = matchedWords / kwWords.length;
    if (matchRatio >= 0.5) {
      return {
        keywordId: keyword.id,
        evidenceStatus: "weak",
        evidenceSummary: `Partial match: ${matchedWords}/${kwWords.length} keyword words found across candidate data`,
        confidence: 0.4 + matchRatio * 0.3,
      };
    }
  }

  // No evidence found
  return {
    keywordId: keyword.id,
    evidenceStatus: "missing",
    evidenceSummary: `No evidence found in candidate profile, resume, or evidence bank`,
    confidence: 0.0,
  };
}

// ───────────────────────────────────────────────────────────────
// AI-assisted evidence mapping (optional enhancement)
// ───────────────────────────────────────────────────────────────

export async function aiMapEvidence(
  keyword: ApplicationKeywordRow,
  candidateId: string
): Promise<EvidenceMappingResult | null> {
  const active = await getActiveProviderAsync();
  if (!active) return null;

  const source = await gatherCandidateEvidenceSources(candidateId);

  const prompt = [
    `Keyword from job description: "${keyword.keyword}" (category: ${keyword.category})`,
    "Candidate profile and evidence:",
    `Profile: ${source.profileText.slice(0, 500)}`,
    `Evidence skills: ${source.evidenceSkills.join(", ")}`,
    `Resume skills: ${source.resumeSkills.join(", ")}`,
    `Base resume skills: ${source.baseResumeSkills.join(", ")}`,
    "",
    "Does this candidate have evidence for this keyword? Respond with ONLY a JSON object:",
    '{"hasEvidence": boolean, "strength": "strong" | "weak" | "none", "explanation": string}',
  ].join("\n");

  try {
    const response = await active.provider.send({
      system: "You are a conservative evidence checker. Only claim evidence exists if you can see it in the data. No invention.",
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      tools: [],
    });
    const raw = textOf(response.content).trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(raw);

    const statusMap: Record<string, "mapped" | "weak" | "missing"> = {
      strong: "mapped",
      weak: "weak",
      none: "missing",
    };

    return {
      keywordId: keyword.id,
      evidenceStatus: statusMap[parsed.strength] ?? "missing",
      evidenceSummary: parsed.explanation ?? "AI-evaluated evidence",
      confidence: parsed.strength === "strong" ? 0.85 : parsed.strength === "weak" ? 0.5 : 0.0,
    };
  } catch {
    return null; // Degrade cleanly
  }
}
