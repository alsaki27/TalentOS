-- 21.3 Per-AE application throughput — read-only.
-- CRITICAL: use application_stage_history filtered to source = 'queue', excluding
-- 'migration' rows. applications.ae_applied_at / ae_stage_updated_at overstate
-- throughput because they carry migration-backfilled timestamps.
-- Params: $window_start, $window_end (timestamptz; adjust timezone as requested).

-- Active AE headcount
SELECT count(*) FROM profiles WHERE is_active = true AND role = 'application_engineer';

-- Per-AE throughput in the window (the trustworthy number)
SELECT h.changed_by_user_id, h.changed_by_name,
       count(DISTINCT h.application_id) FILTER (WHERE h.to_stage = 'ready_for_application') AS reviewed,
       count(DISTINCT h.application_id) FILTER (WHERE h.to_stage = 'applied') AS applied,
       count(DISTINCT h.application_id) AS unique_tickets_touched
FROM application_stage_history h
WHERE h.source = 'queue'
  AND h.changed_at >= $window_start
  AND h.changed_at <  $window_end
GROUP BY h.changed_by_user_id, h.changed_by_name
ORDER BY applied DESC, reviewed DESC;

-- Optional side-by-side comparison against the stamped columns (expect this to be
-- HIGHER and to include migration noise -- report the gap, don't just swap it in):
-- SELECT ae_applied_by_user_id, ae_applied_by_name, count(*) AS stamped_applied_count
-- FROM applications
-- WHERE ae_applied_at >= $window_start AND ae_applied_at < $window_end
-- GROUP BY ae_applied_by_user_id, ae_applied_by_name;
