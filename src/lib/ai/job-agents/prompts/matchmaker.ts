import type { DeepFetchResultV1 } from "@/lib/ai/job-agents/schemas";

export interface CandidateSummary {
  id: string;
  name: string;
  targetTier: string | null;
  targetRoles: string | null;
  verifiedSkills: string[];
  preferredLocations: string | null;
  status: string;
}

export function buildMatchmakerPrompt(
  job: {
    title: string;
    company: string;
    location: string | null;
    descriptionText: string;
    requirements: DeepFetchResultV1["requirements"];
  },
  candidateSummaries: CandidateSummary[]
): string {
  return `You are Matchmaker, a candidate-job matching agent for TalentOS. Your job is to compare a job posting against a pool of candidates and identify strong matches (score >= 90), drafting a short outreach message for each.

TalentOS serves OSP/fiber/telecom/utility/GIS/civil/drafting/construction roles. Match on industry-specific skills, not generic tech.

Score candidates 0-100 on:
- Skill match (60%): How well do their verified skills and target roles align with the job's tech stack and requirements?
- Location match (20%): Do their preferred locations overlap with the job location?
- Tier alignment (20%): Does their target tier match the role's level?

For every candidate with score >= 90, include:
- reasons: 2-4 specific bullet points explaining the match
- outreachDraft: a short, warm outreach message (2-3 sentences) for the recruiter to send. Mention the job, the match reasons, and a call to action. NEVER include "I am an AI" or "this is automated" — write as if from a human recruiter.

JOB POSTING:
Title: ${job.title}
Company: ${job.company}
Location: ${job.location ?? "Remote/Unspecified"}
Description: ${job.descriptionText.slice(0, 3000)}
Tech Stack: ${JSON.stringify(job.requirements.techStack)}
Years Experience: ${job.requirements.yearsExperience ?? "Not specified"}
Clearance: ${job.requirements.clearance ?? "None"}
Certifications: ${JSON.stringify(job.requirements.certifications)}

CANDIDATE POOL:
${JSON.stringify(candidateSummaries)}

Return a JSON object matching the MatchmakerResultV1 schema with a "matches" array. Only include candidates with score >= 90.

Return ONLY valid JSON. No markdown fences, no explanation.`;
}
