// Selects the best-matching base resume for a candidate given a target job.
// Scores base resumes by comparing target_industry/target_roles against the
// job's job_category/title/description fields. "Most recent" is used only as
// a last resort when no domain signal exists.

import { query as neonQuery } from "@/server/db/neon";

interface BaseResumeCandidate {
  id: string;
  name: string;
  target_industry: string | null;
  target_roles: string[] | null;
  content: any;
}

interface TargetJob {
  title?: string | null;
  job_category?: string | null;
  description_text?: string | null;
  company?: string | null;
  location?: string | null;
}

export interface BestBaseResumeResult {
  resume: BaseResumeCandidate;
  score: number;
  reason: string;
}

function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2)
  );
}

function domainScore(base: BaseResumeCandidate, job: TargetJob): { score: number; reason: string } {
  let score = 0;
  const reasons: string[] = [];

  const jobTokens = tokenize([
    job.job_category ?? "",
    job.title ?? "",
    job.description_text ?? "",
  ].join(" "));

  // Industry match (strongest signal)
  if (base.target_industry && job.job_category) {
    const industryTokens = tokenize(base.target_industry);
    const jobCatTokens = tokenize(job.job_category);
    const overlap = new Set([...industryTokens].filter((t) => jobCatTokens.has(t)));
    if (overlap.size > 0) {
      score += overlap.size * 3;
      reasons.push(`target industry "${base.target_industry}" matches job category "${job.job_category}"`);
    } else {
      // Check for substring/partial match
      const indLower = base.target_industry.toLowerCase();
      const catLower = job.job_category.toLowerCase();
      if (indLower.includes(catLower) || catLower.includes(indLower)) {
        score += 2;
        reasons.push(`target industry "${base.target_industry}" partially matches job category "${job.job_category}"`);
      }
    }
  }

  // Role match
  if (base.target_roles && base.target_roles.length > 0) {
    for (const role of base.target_roles) {
      const roleTokens = tokenize(role);
      const overlap = new Set([...roleTokens].filter((t) => jobTokens.has(t)));
      if (overlap.size > 0) {
        score += overlap.size * 2;
        reasons.push(`target role "${role}" matches job`);
      }
    }
  }

  // Keyword density from base resume content
  if (base.content) {
    const contentText = typeof base.content === "string"
      ? base.content
      : JSON.stringify(base.content);
    const contentTokens = tokenize(contentText);
    const keywordOverlap = new Set([...jobTokens].filter((t) => contentTokens.has(t)));
    if (keywordOverlap.size > 0) {
      // Small bonus — content match is lower confidence than explicit industry/role
      score += Math.min(keywordOverlap.size, 5);
    }
  }

  return {
    score,
    reason: reasons.length > 0 ? reasons.join("; ") : "no domain match — fallback to most recent",
  };
}

export async function selectBestBaseResume(
  candidateId: string,
  targetJob: TargetJob
): Promise<BestBaseResumeResult | null> {
  const rows = await neonQuery<BaseResumeCandidate>(
    `SELECT id, name, target_industry, target_roles, content
     FROM base_resumes
     WHERE candidate_id = $1 AND status = 'approved'
       AND (target_industry IS NOT NULL OR target_roles IS NOT NULL AND array_length(target_roles, 1) > 0)
     ORDER BY created_at DESC`,
    [candidateId]
  );

  if (rows.length === 0) return null;

  let best: BestBaseResumeResult | null = null;
  for (const row of rows) {
    const { score, reason } = domainScore(row, targetJob);
    if (!best || score > best.score) {
      best = { resume: row, score, reason };
    }
  }

  return best;
}
