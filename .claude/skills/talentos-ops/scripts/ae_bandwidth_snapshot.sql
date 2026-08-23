-- 21.5 Live AE bandwidth / ownership snapshot — read-only.
-- Reproduces EXECUTIVE_AE_BANDWIDTH_REPORT_2026-08-11.md on demand.

-- Current open ownership by AE and stage
SELECT p.display_name, a.application_stage, count(*)
FROM applications a
JOIN profiles p ON p.user_id = a.assigned_to_user_id
WHERE p.role = 'application_engineer' AND p.is_active = true
  AND a.application_stage NOT IN ('applied','rejected','withdrawn','closed','offer')
GROUP BY p.display_name, a.application_stage
ORDER BY p.display_name;

-- Unassigned AI-pipeline backlog (the routing problem the last report flagged:
-- 279 unassigned vs. 44 assigned to active AEs)
SELECT count(*) FROM applications
WHERE application_stage = 'in_ai_pipeline' AND assigned_to_user_id IS NULL;

-- Reconciliation: open-ticket total should tie out to this
SELECT count(*) FROM applications
WHERE application_stage NOT IN ('applied','rejected','withdrawn','closed');
