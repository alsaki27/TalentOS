import { query } from "@/server/db/neon";
import type { CandidateSummary } from "./prompts/matchmaker";

export async function loadCandidateSummaries(limit?: number): Promise<CandidateSummary[]> {
  return query<CandidateSummary>(
    `SELECT c.id, c.name, c.target_tier AS "targetTier", c.target_roles AS "targetRoles",
            c.verified_skills AS "verifiedSkills", c.preferred_locations AS "preferredLocations",
            c.status
     FROM candidates c
     WHERE c.status = 'active'
       AND COALESCE(c.pipeline_stage, 'not_started') <> 'paused'
       AND c.verified_skills IS NOT NULL
       AND array_length(c.verified_skills, 1) > 0
     ORDER BY c.created_at DESC
     LIMIT $1`,
    [limit ?? 100]
  );
}
