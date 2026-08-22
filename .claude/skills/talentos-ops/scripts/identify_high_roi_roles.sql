-- 21.1 Identify high-ROI roles — read-only.
-- Ranked, unactioned, recommended matches across all active candidates.
-- Params: $freshness_days (default 7), $limit (default 100).

SELECT d.id AS decision_id, d.candidate_id, c.name AS candidate_name,
       d.base_resume_id, br.name AS base_resume_name,
       d.job_id, j.title, j.company, j.location, j.posted_at,
       d.score, d.tier, d.outcome, d.review_status,
       d.matched_terms, d.hard_gates, d.application_id
FROM candidate_job_match_decisions d
JOIN candidates c ON c.id = d.candidate_id
JOIN jobs j ON j.id = d.job_id
JOIN base_resumes br ON br.id = d.base_resume_id
WHERE d.outcome = 'recommended'
  AND d.review_status IN ('pending', 'not_applicable')
  AND j.posted_at >= now() - ($freshness_days || ' days')::interval
  AND c.status = 'active'
ORDER BY d.tier ASC, d.score DESC, j.posted_at DESC
LIMIT $limit;
