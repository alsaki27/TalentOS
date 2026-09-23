// src/server/repositories/candidateEvidenceRepository.ts
// Neon-only data-access for candidate evidence, profiles, resumes, base resumes, and application keywords.
// Used by evidenceMappingService and resumeContextService.

import { query, queryOne } from "@/server/db/neon";

export interface CandidateProfileRow {
  id: string;
  name: string | null;
  target_roles: string | null;
  target_industries: string[] | null;
  work_authorization: string | null;
  visa_status: string | null;
  notes: string | null;
  skills: string | null;
}

export interface CandidateEvidenceRow {
  id: string;
  title: string;
  description: string | null;
  related_skills: string[];
  source_type: string | null;
  proof_url: string | null;
}

export interface ResumeRow {
  parsed_json: unknown;
}

export interface BaseResumeRow {
  content: unknown;
}

export interface ApplicationKeywordRow {
  id: string;
  application_id: string;
  job_id: string | null;
  keyword: string;
  normalized_keyword: string;
  category: string;
  importance: string;
  source: string;
  status: string;
  ai_reason: string | null;
  user_reason: string | null;
  evidence_summary: string | null;
  evidence_status: string;
  created_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function findCandidateEvidenceProfile(candidateId: string): Promise<CandidateProfileRow> {
  const row = await queryOne<CandidateProfileRow>(
    `SELECT id, name, target_roles, target_industries, work_authorization, visa_status, notes, skills
     FROM candidates WHERE id = $1`,
    [candidateId]
  );
  if (!row) throw new Error(`Candidate not found: ${candidateId}`);
  return row;
}

export async function listCandidateEvidence(candidateId: string): Promise<CandidateEvidenceRow[]> {
  return query<CandidateEvidenceRow>(
    `SELECT id, title, description, related_skills, source_type, proof_url
     FROM candidate_evidence
     WHERE candidate_id = $1
     ORDER BY created_at DESC`,
    [candidateId]
  );
}

export async function findLatestOriginalResume(candidateId: string): Promise<ResumeRow | null> {
  return queryOne<ResumeRow>(
    `SELECT parsed_json
     FROM resumes
     WHERE candidate_id = $1 AND is_original_upload = true
     ORDER BY created_at DESC
     LIMIT 1`,
    [candidateId]
  );
}

export async function findLatestBaseResumeContent(candidateId: string): Promise<BaseResumeRow | null> {
  return queryOne<BaseResumeRow>(
    `SELECT content
     FROM base_resumes
     WHERE candidate_id = $1
     ORDER BY updated_at DESC
     LIMIT 1`,
    [candidateId]
  );
}

export async function findApplicationKeywords(applicationId: string): Promise<ApplicationKeywordRow[]> {
  return query<ApplicationKeywordRow>(
    `SELECT * FROM application_job_keywords WHERE application_id = $1`,
    [applicationId]
  );
}
