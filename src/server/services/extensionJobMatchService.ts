import { evaluateCandidateJob, type CandidateJobEvaluation } from "@/lib/candidateJobMatcher";
import { chooseBestBaseResume, scoreBaseResumeDomainFit } from "@/lib/ai/selectBestBaseResume";
import { query, queryOne } from "@/server/db/neon";

interface CandidateResumeRow {
  candidate_id: string;
  candidate_name: string;
  pipeline_stage: string | null;
  base_resume_id: string;
  resume_name: string;
  resume_status: string | null;
  resume_updated_at: string | null;
  resume_content: unknown;
  profile_review_status: string | null;
  profile_version: number | null;
  approved_profile_version: number | null;
  resume_content_hash: string | null;
  keywords: string[] | null;
  keyword_states: unknown;
  additional_rules: string | null;
  work_authorization: string | null;
  visa_status: string | null;
  preferred_locations: string | null;
  target_industry: string | null;
  target_roles: string[] | null;
}

function resumeText(content: unknown): string {
  if (typeof content === "string") return content;
  try { return JSON.stringify(content ?? {}); } catch { return ""; }
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function profileTerms(row: CandidateResumeRow) {
  const states = Array.isArray(row.keyword_states)
    ? row.keyword_states as Array<{ term?: unknown; status?: unknown }>
    : [];
  if (states.length) {
    return {
      activeTerms: states.filter((x) => typeof x.term === "string" && x.term.trim() && x.status !== "dismissed").map((x) => String(x.term).trim()),
      dismissedTerms: states.filter((x) => typeof x.term === "string" && x.term.trim() && x.status === "dismissed").map((x) => String(x.term).trim()),
    };
  }
  return { activeTerms: Array.isArray(row.keywords) ? row.keywords : [], dismissedTerms: [] };
}

const ACTIVE_CANDIDATE_SQL = `c.status = 'active'
  AND COALESCE(c.pipeline_stage, 'not_started') NOT IN ('paused', 'placed', 'dropped')`;

export interface ExtensionCandidateOption {
  candidateId: string;
  candidateName: string;
  pipelineStage: string;
  alreadyLogged: boolean;
}

export interface ExtensionResumeOption {
  baseResumeId: string;
  baseResumeName: string;
  score: number | null;
  scoreType: "approved_profile" | "local_resume_relevance";
  tier: "A" | "B" | null;
  recommended: boolean;
  talentOsDefault: boolean;
  reason: string;
  matchedTerms: string[];
  hardGates: string[];
  profileStatus: "approved" | "not_approved" | "stale" | "no_profile";
  updatedAt: string | null;
}

export interface ExtensionCandidateResumeOptions {
  candidateId: string;
  candidateName: string;
  pipelineStage: string;
  resumeOptions: ExtensionResumeOption[];
  bestResumeId: string;
}

export async function listExtensionCandidates(jobId: string): Promise<ExtensionCandidateOption[]> {
  return query<ExtensionCandidateOption>(
    `SELECT c.id AS "candidateId", c.name AS "candidateName",
            COALESCE(c.pipeline_stage, 'not_started') AS "pipelineStage",
            EXISTS (
              SELECT 1 FROM applications a
               WHERE a.candidate_id = c.id AND a.job_id = $1
            ) AS "alreadyLogged"
       FROM candidates c
      WHERE ${ACTIVE_CANDIDATE_SQL}
        AND EXISTS (
          SELECT 1 FROM base_resumes br
           WHERE br.candidate_id = c.id AND COALESCE(br.status, 'active') <> 'archived'
        )
      ORDER BY CASE COALESCE(c.pipeline_stage, 'not_started') WHEN 'applying' THEN 0 ELSE 1 END,
               c.name ASC
      `,
    [jobId],
  );
}

export async function getExtensionCandidateResumeOptions(
  jobId: string,
  candidateId: string,
  now = new Date(),
): Promise<ExtensionCandidateResumeOptions> {
  const job = await queryOne<{
    id: string; title: string; company: string | null; location: string | null; job_category: string | null;
    description_text: string | null; raw_description: string | null;
    seniority_level: string | null; posted_at: string | null;
  }>(
    `SELECT id, title, company, location, job_category, description_text, raw_description,
            seniority_level, posted_at::text
       FROM jobs
      WHERE id = $1 AND COALESCE(is_active, true) = true`,
    [jobId],
  );
  if (!job) throw new Error("Job is missing or inactive");

  const rows = await query<CandidateResumeRow>(
    `SELECT c.id AS candidate_id, c.name AS candidate_name,
            COALESCE(c.pipeline_stage, 'not_started') AS pipeline_stage,
            br.id AS base_resume_id, br.name AS resume_name, br.status AS resume_status,
            br.updated_at::text AS resume_updated_at, br.content AS resume_content,
            br.target_industry, br.target_roles,
            p.review_status AS profile_review_status, p.profile_version,
            p.approved_profile_version, p.resume_content_hash, p.keywords,
            p.keyword_states, p.additional_rules,
            c.work_authorization, c.visa_status, c.preferred_locations
       FROM candidates c
       JOIN base_resumes br ON br.candidate_id = c.id
       LEFT JOIN candidate_resume_search_profiles p
         ON p.candidate_id = c.id AND p.base_resume_id = br.id
      WHERE c.id = $1 AND ${ACTIVE_CANDIDATE_SQL}
        AND COALESCE(br.status, 'active') <> 'archived'
      ORDER BY br.created_at DESC NULLS LAST, br.updated_at DESC NULLS LAST, br.name ASC`,
    [candidateId],
  );
  if (!rows.length) throw new Error("Active candidate or base resumes not found");

  const candidate = rows[0];
  const description = job.description_text ?? job.raw_description ?? "";
  const resumeOptions: ExtensionResumeOption[] = [];
  const jobTarget = {
    title: job.title,
    job_category: job.job_category,
    description_text: description,
    company: job.company,
    location: job.location,
  };

  // This is the same approved-resume eligibility and domain scoring used by
  // the application AI workflow. If it has no eligible resume, the workflow
  // falls back to the newest available base resume; mirror that deterministic
  // fallback here and never spend an AI token to choose a resume.
  const talentOsChoice = chooseBestBaseResume(
    rows
      .filter((row) => row.resume_status === "approved"
        && (row.target_industry !== null || (row.target_roles?.length ?? 0) > 0))
      .map((row) => ({
        id: row.base_resume_id,
        name: row.resume_name,
        target_industry: row.target_industry,
        target_roles: row.target_roles,
        content: row.resume_content,
      })),
    jobTarget,
  );
  const bestResumeId = talentOsChoice?.resume.id ?? rows[0].base_resume_id;

  for (const row of rows) {
    const terms = profileTerms(row);
    let profileStatus: ExtensionResumeOption["profileStatus"] = "no_profile";
    let result: CandidateJobEvaluation | null = null;

    if (row.profile_review_status) {
      const approved = row.profile_review_status === "approved"
        && row.approved_profile_version === row.profile_version;
      if (!approved) {
        profileStatus = "not_approved";
      } else {
        const contentHash = await sha256Hex(JSON.stringify(row.resume_content ?? {}));
        // The main candidate-job matcher only accepts a profile when its
        // approved resume hash exists and still matches the current content.
        if (!row.resume_content_hash || contentHash !== row.resume_content_hash) {
          profileStatus = "stale";
        } else if (terms.activeTerms.length) {
          profileStatus = "approved";
          result = evaluateCandidateJob(
            {
              workAuthorization: row.work_authorization,
              visaStatus: row.visa_status,
              preferredLocations: row.preferred_locations,
              resumeText: resumeText(row.resume_content),
            },
            { ...terms, additionalRules: row.additional_rules },
            {
              title: job.title,
              company: job.company,
              location: job.location,
              description,
              seniorityLevel: job.seniority_level,
              postedAt: job.posted_at,
            },
            // Keep the project's existing deterministic TalentOS matching
            // thresholds. The UI still exposes lower scores for human review.
            { now, freshnessDays: 7, tierAMin: 85, tierBMin: 70 },
          );
        } else {
          profileStatus = "approved";
        }
      }
    }

    // No AI call is made for unapproved, stale, or missing profiles. Use the
    // same deterministic role/industry/content matcher the resume workflow
    // uses as a low-cost fallback so the best available resume is still
    // preselected for a human to review.
    const localFit = result ? null : scoreBaseResumeDomainFit({
      id: row.base_resume_id,
      name: row.resume_name,
      target_industry: row.target_industry,
      target_roles: row.target_roles,
      content: row.resume_content,
    }, jobTarget);

    const unavailableReason = profileStatus === "no_profile"
      ? "No resume search profile is available."
      : profileStatus === "not_approved"
        ? "Resume search profile is not approved."
        : profileStatus === "stale"
          ? "Resume changed since the profile was approved."
          : "Approved profile has no active search terms.";
    const fitReason = result?.reason
      ?? `${unavailableReason} Local relevance: ${localFit?.score ?? 0} points. ${localFit?.reason ?? "No resume domain signal was found."} This is a heuristic estimate; it does not use AI.`;
    const selectionReason = row.base_resume_id === bestResumeId
      ? talentOsChoice
        ? `TalentOS selected this as its strongest approved domain match: ${talentOsChoice.reason}.`
        : "TalentOS fallback selected the most recently created available base resume."
      : "";

    resumeOptions.push({
      baseResumeId: row.base_resume_id,
      baseResumeName: row.resume_name,
      score: result?.score ?? localFit?.score ?? null,
      scoreType: result ? "approved_profile" : "local_resume_relevance",
      tier: result?.tier ?? null,
      recommended: result?.outcome === "recommended",
      talentOsDefault: row.base_resume_id === bestResumeId,
      reason: [selectionReason, fitReason].filter(Boolean).join(" "),
      matchedTerms: result?.matchedTerms ?? [],
      hardGates: result?.hardGates ?? [],
      profileStatus,
      updatedAt: row.resume_updated_at,
    });
  }

  resumeOptions.sort((a, b) => {
    if (a.talentOsDefault !== b.talentOsDefault) return a.talentOsDefault ? -1 : 1;
    const rank = (item: ExtensionResumeOption) => item.scoreType === "approved_profile" ? 2 : 1;
    if (rank(a) !== rank(b)) return rank(b) - rank(a);
    if (a.score !== null && b.score !== null && a.score !== b.score) return b.score - a.score;
    if (a.score !== null && b.score === null) return -1;
    if (a.score === null && b.score !== null) return 1;
    const updatedA = a.updatedAt ? Date.parse(a.updatedAt) : 0;
    const updatedB = b.updatedAt ? Date.parse(b.updatedAt) : 0;
    if (updatedA !== updatedB) return updatedB - updatedA;
    return (a.baseResumeName || "").localeCompare(b.baseResumeName || "");
  });

  return {
    candidateId: candidate.candidate_id,
    candidateName: candidate.candidate_name,
    pipelineStage: candidate.pipeline_stage || "not_started",
    resumeOptions,
    bestResumeId,
  };
}

export async function validateExtensionResumeMatch(jobId: string, candidateId: string, baseResumeId: string, now = new Date()) {
  const candidate = await getExtensionCandidateResumeOptions(jobId, candidateId, now);
  const resume = candidate.resumeOptions.find((item) => item.baseResumeId === baseResumeId);
  if (!resume) throw new Error("The selected candidate or base resume is no longer eligible. Refresh the candidate list.");
  return { candidate, resume };
}
