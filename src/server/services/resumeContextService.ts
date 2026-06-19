// src/server/services/resumeContextService.ts
// Gathers all candidate evidence sources for resume suggestion generation.
// Loads profile, evidence bank, uploaded resume, and base resume content.
// Never invents data — returns exactly what exists in the database.

import { supabase } from "@/lib/supabase";

export interface ResumeContext {
  candidateId: string;
  candidateName: string | null;
  targetRoles: string | null;
  targetIndustries: string[] | null;
  workAuthorization: string | null;
  visaStatus: string | null;
  notes: string | null;
  skills: string | null;
  evidenceBank: EvidenceBankItem[];
  uploadedResume: UploadedResumeData | null;
  baseResume: BaseResumeData | null;
}

export interface EvidenceBankItem {
  id: string;
  title: string;
  description: string | null;
  related_skills: string[];
  evidence_type: string | null;
  url: string | null;
}

export interface UploadedResumeData {
  parsedSkills: string[];
  parsedExperience: ParsedExperience[];
  parsedEducation: ParsedEducation[];
  rawText: string | null;
}

export interface ParsedExperience {
  title: string;
  company: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  bullets: string[];
}

export interface ParsedEducation {
  degree: string;
  school: string;
  graduationDate?: string;
}

export interface BaseResumeData {
  header: { fullName: string; location?: string; phone?: string; email?: string; linkedin?: string; github?: string; portfolio?: string };
  summary?: string;
  skills: { title: string; skills: string[] }[];
  experience: { title: string; company: string; location?: string; startDate?: string; endDate?: string; bullets: string[] }[];
  education: { degree: string; school: string; graduationDate?: string }[];
  certifications?: { name: string; issuer?: string; date?: string }[];
  projects?: { title: string; description?: string; bullets: string[] }[];
}

// ───────────────────────────────────────────────────────────────
// Public entry point
// ───────────────────────────────────────────────────────────────

export async function buildResumeContext(candidateId: string): Promise<ResumeContext> {
  const [
    candidateRes,
    evidenceRes,
    resumeRes,
    baseResumeRes,
  ] = await Promise.all([
    supabase
      .from("candidates")
      .select("id, name, target_roles, target_industries, work_authorization, visa_status, notes, skills")
      .eq("id", candidateId)
      .single(),
    supabase
      .from("candidate_evidence")
      .select("id, title, description, related_skills, evidence_type, url")
      .eq("candidate_id", candidateId)
      .order("created_at", { ascending: false }),
    supabase
      .from("resumes")
      .select("parsed_json, raw_text")
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

  // Parse evidence bank
  const evidenceBank: EvidenceBankItem[] = [];
  for (const ev of (evidenceRes.data ?? []) as any[]) {
    evidenceBank.push({
      id: ev.id ?? "",
      title: ev.title ?? "",
      description: ev.description ?? null,
      related_skills: Array.isArray(ev.related_skills) ? ev.related_skills.filter((s: any) => typeof s === "string") : [],
      evidence_type: ev.evidence_type ?? null,
      url: ev.url ?? null,
    });
  }

  // Parse uploaded resume
  const uploadedResume = parseUploadedResume(resumeRes.data?.parsed_json as Record<string, unknown> | null, resumeRes.data?.raw_text ?? null);

  // Parse base resume
  const baseResume = parseBaseResume(baseResumeRes.data?.content as Record<string, unknown> | null);

  return {
    candidateId,
    candidateName: candidate.name ?? null,
    targetRoles: candidate.target_roles ?? null,
    targetIndustries: candidate.target_industries ?? null,
    workAuthorization: candidate.work_authorization ?? null,
    visaStatus: candidate.visa_status ?? null,
    notes: candidate.notes ?? null,
    skills: candidate.skills ?? null,
    evidenceBank,
    uploadedResume,
    baseResume,
  };
}

// ───────────────────────────────────────────────────────────────
// Parsers
// ───────────────────────────────────────────────────────────────

function parseUploadedResume(
  parsed: Record<string, unknown> | null,
  rawText: string | null
): UploadedResumeData | null {
  if (!parsed) return null;

  const parsedSkills: string[] = [];
  const parsedExperience: ParsedExperience[] = [];
  const parsedEducation: ParsedEducation[] = [];

  // Skills
  if (Array.isArray(parsed.skills)) {
    for (const s of parsed.skills) {
      if (typeof s === "string") parsedSkills.push(s);
      else if (typeof s === "object" && s && "name" in s) parsedSkills.push((s as any).name);
    }
  }

  // Experience
  if (Array.isArray(parsed.experience)) {
    for (const exp of parsed.experience) {
      if (typeof exp === "object" && exp) {
        const bullets: string[] = [];
        if (Array.isArray(exp.bullets)) {
          for (const b of exp.bullets) {
            if (typeof b === "string") bullets.push(b);
            else if (typeof b === "object" && b && b.text) bullets.push(b.text);
          }
        }
        parsedExperience.push({
          title: exp.title ?? "",
          company: exp.company ?? "",
          location: exp.location,
          startDate: exp.startDate,
          endDate: exp.endDate,
          description: exp.description,
          bullets,
        });
      }
    }
  }

  // Education
  if (Array.isArray(parsed.education)) {
    for (const edu of parsed.education) {
      if (typeof edu === "object" && edu) {
        parsedEducation.push({
          degree: edu.degree ?? "",
          school: edu.school ?? "",
          graduationDate: edu.graduationDate,
        });
      }
    }
  }

  return {
    parsedSkills,
    parsedExperience,
    parsedEducation,
    rawText: rawText ?? null,
  };
}

function parseBaseResume(content: Record<string, unknown> | null): BaseResumeData | null {
  if (!content) return null;

  const header: BaseResumeData["header"] = { fullName: "" };
  if (typeof content.header === "object" && content.header) {
    const h = content.header as any;
    header.fullName = h.fullName ?? "";
    header.location = h.location;
    header.phone = h.phone;
    header.email = h.email;
    header.linkedin = h.linkedin;
    header.github = h.github;
    header.portfolio = h.portfolio;
  }

  const skills: BaseResumeData["skills"] = [];
  if (Array.isArray(content.skills)) {
    for (const s of content.skills) {
      if (typeof s === "object" && s) {
        skills.push({
          title: s.title ?? "",
          skills: Array.isArray(s.skills) ? s.skills.filter((x: any) => typeof x === "string") : [],
        });
      }
    }
  }

  const experience: BaseResumeData["experience"] = [];
  if (Array.isArray(content.experience)) {
    for (const exp of content.experience) {
      if (typeof exp === "object" && exp) {
        const bullets: string[] = [];
        if (Array.isArray(exp.bullets)) {
          for (const b of exp.bullets) {
            if (typeof b === "object" && b && b.text) bullets.push(b.text);
          }
        }
        experience.push({
          title: exp.title ?? "",
          company: exp.company ?? "",
          location: exp.location,
          startDate: exp.startDate,
          endDate: exp.endDate,
          bullets,
        });
      }
    }
  }

  const education: BaseResumeData["education"] = [];
  if (Array.isArray(content.education)) {
    for (const edu of content.education) {
      if (typeof edu === "object" && edu) {
        education.push({
          degree: edu.degree ?? "",
          school: edu.school ?? "",
          graduationDate: edu.graduationDate,
        });
      }
    }
  }

  const certifications: BaseResumeData["certifications"] = [];
  if (Array.isArray(content.certifications)) {
    for (const c of content.certifications) {
      if (typeof c === "object" && c) {
        certifications.push({
          name: c.name ?? "",
          issuer: c.issuer,
          date: c.date,
        });
      }
    }
  }

  const projects: BaseResumeData["projects"] = [];
  if (Array.isArray(content.projects)) {
    for (const p of content.projects) {
      if (typeof p === "object" && p) {
        const bullets: string[] = [];
        if (Array.isArray(p.bullets)) {
          for (const b of p.bullets) {
            if (typeof b === "object" && b && b.text) bullets.push(b.text);
          }
        }
        projects.push({
          title: p.title ?? "",
          description: p.description,
          bullets,
        });
      }
    }
  }

  return {
    header,
    summary: typeof content.summary === "object" && content.summary ? (content.summary as any).text : typeof content.summary === "string" ? content.summary : undefined,
    skills,
    experience,
    education,
    certifications: certifications.length > 0 ? certifications : undefined,
    projects: projects.length > 0 ? projects : undefined,
  };
}

// ───────────────────────────────────────────────────────────────
// Evidence text builder (for AI prompts)
// ───────────────────────────────────────────────────────────────

export function buildEvidenceText(context: ResumeContext): string {
  const parts: string[] = [];

  if (context.candidateName) parts.push(`Candidate: ${context.candidateName}`);
  if (context.targetRoles) parts.push(`Target roles: ${context.targetRoles}`);
  if (context.targetIndustries) parts.push(`Target industries: ${context.targetIndustries.join(", ")}`);
  if (context.workAuthorization) parts.push(`Work authorization: ${context.workAuthorization}`);
  if (context.visaStatus) parts.push(`Visa status: ${context.visaStatus}`);
  if (context.notes) parts.push(`Notes: ${context.notes}`);
  if (context.skills) parts.push(`Skills (from profile): ${context.skills}`);

  if (context.evidenceBank.length > 0) {
    parts.push("\nEvidence Bank:");
    for (const ev of context.evidenceBank) {
      parts.push(`  - ${ev.title}${ev.description ? `: ${ev.description}` : ""}${ev.related_skills.length > 0 ? ` [skills: ${ev.related_skills.join(", ")}]` : ""}`);
    }
  }

  if (context.uploadedResume) {
    parts.push("\nUploaded Resume Skills:");
    parts.push(context.uploadedResume.parsedSkills.join(", "));
    parts.push("\nUploaded Resume Experience:");
    for (const exp of context.uploadedResume.parsedExperience.slice(0, 5)) {
      parts.push(`  ${exp.title} at ${exp.company} (${exp.startDate ?? ""} - ${exp.endDate ?? "present"})`);
      for (const b of exp.bullets.slice(0, 3)) parts.push(`    • ${b}`);
    }
  }

  if (context.baseResume) {
    parts.push("\nBase Resume Skills:");
    for (const sg of context.baseResume.skills) {
      parts.push(`  ${sg.title}: ${sg.skills.join(", ")}`);
    }
  }

  return parts.join("\n");
}

// ───────────────────────────────────────────────────────────────
// Keyword check helpers
// ───────────────────────────────────────────────────────────────

/**
 * Check if a keyword or phrase exists in the candidate's evidence.
 * Returns the source of evidence if found, null otherwise.
 */
export function findEvidenceForKeyword(
  keyword: string,
  context: ResumeContext
): { source: string; detail: string } | null {
  const kwNorm = keyword.toLowerCase().trim();
  const kwWords = kwNorm.split(/\s+/);

  // Evidence bank skills
  for (const ev of context.evidenceBank) {
    for (const skill of ev.related_skills) {
      if (skill.toLowerCase().includes(kwNorm) || kwNorm.includes(skill.toLowerCase())) {
        return { source: "evidence_bank", detail: `${ev.title}: ${skill}` };
      }
    }
  }

  // Uploaded resume skills
  for (const skill of context.uploadedResume?.parsedSkills ?? []) {
    if (skill.toLowerCase().includes(kwNorm) || kwNorm.includes(skill.toLowerCase())) {
      return { source: "uploaded_resume", detail: `Resume skill: ${skill}` };
    }
  }

  // Base resume skills
  for (const sg of context.baseResume?.skills ?? []) {
    for (const skill of sg.skills) {
      if (skill.toLowerCase().includes(kwNorm) || kwNorm.includes(skill.toLowerCase())) {
        return { source: "base_resume", detail: `Base resume skill: ${skill}` };
      }
    }
  }

  // Experience mentions
  for (const exp of context.uploadedResume?.parsedExperience ?? []) {
    const expText = `${exp.title} ${exp.company} ${exp.description ?? ""} ${exp.bullets.join(" ")}`.toLowerCase();
    if (expText.includes(kwNorm)) {
      return { source: "uploaded_resume_experience", detail: `${exp.title} at ${exp.company}` };
    }
  }

  for (const exp of context.baseResume?.experience ?? []) {
    const expText = `${exp.title} ${exp.company} ${exp.bullets.join(" ")}`.toLowerCase();
    if (expText.includes(kwNorm)) {
      return { source: "base_resume_experience", detail: `${exp.title} at ${exp.company}` };
    }
  }

  // Profile text
  const profileText = [
    context.targetRoles,
    context.targetIndustries?.join(" "),
    context.notes,
    context.skills,
  ].filter(Boolean).join(" ").toLowerCase();
  if (profileText.includes(kwNorm)) {
    return { source: "candidate_profile", detail: "Mentioned in candidate profile" };
  }

  // Partial match for multi-word keywords
  if (kwWords.length > 1) {
    let matchedWords = 0;
    const allText = [
      ...(context.uploadedResume?.parsedSkills.map((s) => s.toLowerCase()) ?? []),
      ...(context.baseResume?.skills.flatMap((sg) => sg.skills.map((s) => s.toLowerCase())) ?? []),
      ...(context.evidenceBank.flatMap((ev) => ev.related_skills.map((s) => s.toLowerCase())) ?? []),
      profileText,
    ].join(" ");
    for (const word of kwWords) {
      if (allText.includes(word)) matchedWords++;
    }
    if (matchedWords / kwWords.length >= 0.5) {
      return { source: "partial_match", detail: `Partial match: ${matchedWords}/${kwWords.length} words found` };
    }
  }

  return null;
}
