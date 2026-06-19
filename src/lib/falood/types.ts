// src/lib/falood/types.ts
// Structured resume document — the source of truth for base resumes and application
// resume versions (base_resumes.content / application_resume_versions.content). Never
// store resumes as plain HTML/PDF only; this JSON is what Falood CLI commands read and
// propose changes to, and what the PDF/DOCX export pipeline (Phase 5) renders from.

export interface ResumeHeader {
  fullName: string;
  location?: string;
  phone?: string;
  email?: string;
  linkedin?: string;
  github?: string;
  portfolio?: string;
}

export interface ResumeBlock {
  id: string;
  text: string;
}

export interface SkillSection {
  id: string;
  title: string;
  skills: string[];
}

export interface ResumeBullet {
  id: string;
  text: string;
  evidenceIds?: string[];
  confidenceScore?: number;
  riskLevel?: "low" | "medium" | "high";
}

export interface ExperienceBlock {
  id: string;
  title: string;
  company: string;
  location?: string;
  startDate: string;
  endDate?: string;
  isCurrent?: boolean;
  bullets: ResumeBullet[];
}

export interface ProjectBlock {
  id: string;
  name: string;
  description?: string;
  technologies?: string[];
  bullets: ResumeBullet[];
  url?: string;
}

export interface EducationBlock {
  id: string;
  degree: string;
  school: string;
  location?: string;
  graduationDate?: string;
}

export interface CertificationBlock {
  id: string;
  name: string;
  issuer?: string;
  date?: string;
}

export interface ResumeCustomSection {
  id: string;
  title: string;
  bullets: ResumeBullet[];
}

export interface ResumeFormatting {
  styleId: string;
  pageFormat: "letter" | "a4";
  fontFamily: string;
  fontSize: number;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  sectionSpacing: number;
  bulletSpacing: number;
  lineHeight: number;
}

export interface ResumeDocument {
  header: ResumeHeader;
  summary?: ResumeBlock;
  skills: SkillSection[];
  experience: ExperienceBlock[];
  projects?: ProjectBlock[];
  education: EducationBlock[];
  certifications?: CertificationBlock[];
  customSections?: ResumeCustomSection[];
  formatting: ResumeFormatting;
}

export function emptyResumeDocument(header: ResumeHeader, formatting: ResumeFormatting): ResumeDocument {
  return {
    header,
    skills: [],
    experience: [],
    education: [],
    formatting,
  };
}

// Structured action the server can propose back to the client. The server never
// writes resume content directly to the database from one of these — applying an
// action is always a separate, explicit user-triggered request.
export type FaloodAction =
  | { type: "update_resume_document"; newContent: ResumeDocument; reason: string }
  | { type: "create_warning"; warningType: "truth_risk" | "ats_risk" | "formatting_risk"; message: string };

export interface FaloodCommandResult {
  message: string;
  action: FaloodAction | null;
  warnings: string[];
}
