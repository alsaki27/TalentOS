-- Verification SQL for Supabase → Neon data migration
-- Run this on BOTH Supabase and Neon, compare results.
-- All counts should match exactly (or Neon should be slightly higher if new data was added during cutover).

-- ============================================================
-- 1. Table row counts
-- ============================================================
SELECT 'Table row counts' AS check_name;

SELECT 
    tablename,
    (xpath('/row/c/text()', query_to_xml(
        format('SELECT count(*) AS c FROM %I', tablename), 
        false, true, ''
    )))[1]::text::int AS row_count
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- ============================================================
-- 2. Critical table counts (manual check)
-- ============================================================
SELECT 'Critical table counts' AS check_name;

SELECT 'candidates' AS table_name, COUNT(*) AS count FROM candidates
UNION ALL
SELECT 'jobs', COUNT(*) FROM jobs
UNION ALL
SELECT 'applications', COUNT(*) FROM applications
UNION ALL
SELECT 'companies', COUNT(*) FROM companies
UNION ALL
SELECT 'company_people', COUNT(*) FROM company_people
UNION ALL
SELECT 'base_resumes', COUNT(*) FROM base_resumes
UNION ALL
SELECT 'resumes', COUNT(*) FROM resumes
UNION ALL
SELECT 'application_resume_versions', COUNT(*) FROM application_resume_versions
UNION ALL
SELECT 'application_resume_suggestions', COUNT(*) FROM application_resume_suggestions
UNION ALL
SELECT 'application_resume_exports', COUNT(*) FROM application_resume_exports
UNION ALL
SELECT 'application_packets', COUNT(*) FROM application_packets
UNION ALL
SELECT 'application_keywords', COUNT(*) FROM application_keywords
UNION ALL
SELECT 'target_jobs', COUNT(*) FROM target_jobs
UNION ALL
SELECT 'job_keywords', COUNT(*) FROM job_keywords
UNION ALL
SELECT 'ai_api_keys', COUNT(*) FROM ai_api_keys
UNION ALL
SELECT 'email_templates', COUNT(*) FROM email_templates
UNION ALL
SELECT 'email_sequences', COUNT(*) FROM email_sequences
UNION ALL
SELECT 'interview_schedules', COUNT(*) FROM interview_schedules
UNION ALL
SELECT 'interview_scorecard_templates', COUNT(*) FROM interview_scorecard_templates
UNION ALL
SELECT 'chat_conversations', COUNT(*) FROM chat_conversations
UNION ALL
SELECT 'chat_messages', COUNT(*) FROM chat_messages
UNION ALL
SELECT 'falood_conversations', COUNT(*) FROM falood_conversations
UNION ALL
SELECT 'falood_messages', COUNT(*) FROM falood_messages
UNION ALL
SELECT 'audit_logs', COUNT(*) FROM audit_logs
UNION ALL
SELECT 'activity_logs', COUNT(*) FROM activity_logs
UNION ALL
SELECT 'notifications', COUNT(*) FROM notifications
UNION ALL
SELECT 'webhook_endpoints', COUNT(*) FROM webhook_endpoints
UNION ALL
SELECT 'integration_accounts', COUNT(*) FROM integration_accounts
UNION ALL
SELECT 'import_sources', COUNT(*) FROM import_sources
ORDER BY table_name;

-- ============================================================
-- 3. Data integrity checks
-- ============================================================
SELECT 'Data integrity checks' AS check_name;

-- 3a. No orphaned applications (all applications must have a candidate)
SELECT 'orphan_applications' AS check_type, COUNT(*) AS violation_count
FROM applications a
WHERE NOT EXISTS (SELECT 1 FROM candidates c WHERE c.id = a.candidate_id);

-- 3b. No orphaned applications (all applications must have a job, unless adhoc)
SELECT 'orphan_applications_no_job' AS check_type, COUNT(*) AS violation_count
FROM applications a
WHERE a.job_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.id = a.job_id);

-- 3c. All active jobs have a title
SELECT 'active_jobs_without_title' AS check_type, COUNT(*) AS violation_count
FROM jobs
WHERE is_active = true AND (title IS NULL OR title = '');

-- 3d. All candidates have a name or email
SELECT 'candidates_without_name_or_email' AS check_type, COUNT(*) AS violation_count
FROM candidates
WHERE (name IS NULL OR name = '') AND (email IS NULL OR email = '');

-- 3e. No duplicate applications (same candidate + same job)
SELECT 'duplicate_applications' AS check_type, COUNT(*) AS violation_count
FROM (
    SELECT candidate_id, job_id, COUNT(*) AS cnt
    FROM applications
    WHERE job_id IS NOT NULL
    GROUP BY candidate_id, job_id
    HAVING COUNT(*) > 1
) dups;

-- 3f. All profiles reference valid user IDs (if profiles table exists)
-- Note: In Neon, user_id is plain UUID with no FK constraint.
SELECT 'profiles_without_user_id' AS check_type, COUNT(*) AS violation_count
FROM profiles
WHERE user_id IS NULL;

-- ============================================================
-- 4. Sequence validation (ensure sequences are set correctly)
-- ============================================================
SELECT 'Sequence validation' AS check_name;

SELECT 
    c.relname AS sequence_name,
    t.relname AS table_name,
    a.attname AS column_name,
    last_value,
    (xpath('/row/c/text()', query_to_xml(
        format('SELECT MAX(%I) AS c FROM %I', a.attname, t.relname), 
        false, true, ''
    )))[1]::text::bigint AS max_column_value
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_depend d ON d.objid = c.oid
JOIN pg_class t ON t.oid = d.refobjid
JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
WHERE c.relkind = 'S' AND n.nspname = 'public'
ORDER BY t.relname;

-- ============================================================
-- 5. Index verification
-- ============================================================
SELECT 'Index verification' AS check_name;

SELECT 
    tablename, 
    indexname, 
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- ============================================================
-- 6. Check for missing indexes (performance-critical queries)
-- ============================================================
SELECT 'Missing indexes check' AS check_name;

-- These are the indexes we expect to exist for performance:
SELECT 'applications.candidate_id' AS expected_index, 
    EXISTS (SELECT 1 FROM pg_indexes WHERE indexname LIKE '%applications_candidate_id%') AS exists
UNION ALL
SELECT 'applications.job_id', 
    EXISTS (SELECT 1 FROM pg_indexes WHERE indexname LIKE '%applications_job_id%')
UNION ALL
SELECT 'jobs.source_url', 
    EXISTS (SELECT 1 FROM pg_indexes WHERE indexname LIKE '%jobs_source_url%')
UNION ALL
SELECT 'jobs.external_job_id', 
    EXISTS (SELECT 1 FROM pg_indexes WHERE indexname LIKE '%jobs_external_job_id%')
UNION ALL
SELECT 'candidates.email', 
    EXISTS (SELECT 1 FROM pg_indexes WHERE indexname LIKE '%candidates_email%')
UNION ALL
SELECT 'applications.status', 
    EXISTS (SELECT 1 FROM pg_indexes WHERE indexname LIKE '%applications_status%')
UNION ALL
SELECT 'applications.assigned_to_user_id', 
    EXISTS (SELECT 1 FROM pg_indexes WHERE indexname LIKE '%applications_assigned_to_user_id%')
UNION ALL
SELECT 'applications.applied_at', 
    EXISTS (SELECT 1 FROM pg_indexes WHERE indexname LIKE '%applications_applied_at%');

-- ============================================================
-- 7. Extension verification
-- ============================================================
SELECT 'Extension verification' AS check_name;

SELECT extname, extversion FROM pg_extension WHERE extname IN ('pgcrypto', 'uuid-ossp', 'pg_trgm') ORDER BY extname;

-- ============================================================
-- 8. Foreign key verification (should be empty since we removed auth.users FKs)
-- ============================================================
SELECT 'Foreign key verification' AS check_name;

SELECT 
    tc.table_name, 
    kcu.column_name, 
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
ORDER BY tc.table_name, kcu.column_name;

-- ============================================================
-- 9. Trigger verification
-- ============================================================
SELECT 'Trigger verification' AS check_name;

SELECT 
    tgname AS trigger_name,
    tgrelid::regclass AS table_name,
    CASE tgtype & 66
        WHEN 2 THEN 'BEFORE'
        WHEN 64 THEN 'INSTEAD OF'
        ELSE 'AFTER'
    END AS timing,
    CASE tgtype & 28
        WHEN 4 THEN 'INSERT'
        WHEN 8 THEN 'DELETE'
        WHEN 16 THEN 'UPDATE'
        WHEN 20 THEN 'INSERT OR UPDATE'
        WHEN 24 THEN 'UPDATE OR DELETE'
        WHEN 28 THEN 'INSERT OR UPDATE OR DELETE'
        ELSE 'UNKNOWN'
    END AS event
FROM pg_trigger
WHERE NOT tgisinternal
AND tgrelid::regclass::text NOT LIKE 'pg_%'
ORDER BY tgrelid::regclass::text, tgname;

-- ============================================================
-- 10. Connection test (run this last to verify connectivity)
-- ============================================================
SELECT 'Connection test' AS check_name, version() AS postgres_version, NOW() AS current_time;
