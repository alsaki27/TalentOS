-- 21.4 Resume-tailoring quality leaderboard — read-only.
-- NOT YET SPOT-CHECKED against live data: confirm the approved_by/reviewed_by/sent_by
-- attribution actually names the AE who worked the ticket before treating a "worst AE"
-- ranking as fact.
-- Scale note (verified against sql/neon_fixes/023_resume_versions_ats_truth_scores.sql,
-- src/lib/scoreScale.ts): ats_score and truth_score are 0-10 decimals. one_page_fit_score
-- is a SEPARATE 0-100 scale (contentUtilization*100, sql/neon_fixes/086_resume_versions_
-- page_fit_metrics.sql) -- do not average it alongside the two 0-10 scores as if comparable,
-- and do not compare any of these to the 0-100 candidate_job_match_decisions.score either.
-- Params: $window_start.

SELECT p.user_id, p.display_name,
       count(*) AS packets,
       avg(rv.ats_score)          AS avg_ats_score,
       avg(rv.truth_score)        AS avg_truth_score,
       avg(rv.one_page_fit_score) AS avg_page_fit,
       count(*) FILTER (WHERE rv.truth_score < 7.0) AS low_truth_count
FROM application_packets ap
JOIN application_resume_versions rv ON rv.id = ap.final_resume_version_id
JOIN profiles p ON p.user_id = COALESCE(ap.approved_by, ap.reviewed_by, ap.sent_by)
WHERE ap.updated_at >= $window_start
GROUP BY p.user_id, p.display_name
ORDER BY avg_truth_score ASC, avg_ats_score ASC;

-- Second, independent quality signal: fabrication-risk suggestions per application,
-- cross-referenced back to the same application's packet reviewer.
-- SELECT ap.reviewed_by, count(*) AS fabrication_risk_suggestions
-- FROM application_resume_suggestions s
-- JOIN application_packets ap ON ap.application_id = s.application_id
-- WHERE s.truth_status = 'fabrication_risk'
-- GROUP BY ap.reviewed_by;
