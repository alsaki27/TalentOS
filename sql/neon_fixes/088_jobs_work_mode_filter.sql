-- Adds a real, queryable work_mode column (remote/hybrid/onsite) to jobs so
-- the Jobs and Application Queue pages can filter by it. Coverage today is
-- split across multiple places depending on how a job was created: AI-parsed
-- JDs (jobs.parsed_description->>'workplaceType'), crawler-sourced jobs
-- (jobs.raw_source_payload->>'workplaceType'), and nothing at all for
-- manually-created/imported jobs. infer_job_work_mode() is one shared,
-- reusable inference used both to backfill existing rows below and by a
-- trigger that fills new/updated rows going forward from whichever signal is
-- available, so every job-creation path (there are over a dozen) is covered
-- without having to edit each one individually. Word-boundary regex on the
-- location/notes text fallback avoids false positives like "Remote Sensing
-- Engineer" matching on "remote".

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS work_mode text;

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
      FROM pg_constraint con
     WHERE con.conrelid = 'jobs'::regclass
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%work_mode%'
  LOOP
    EXECUTE format('ALTER TABLE jobs DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE jobs
  ADD CONSTRAINT jobs_work_mode_check
  CHECK (work_mode IS NULL OR work_mode IN ('remote', 'hybrid', 'onsite'));

CREATE OR REPLACE FUNCTION infer_job_work_mode(
  p_location text,
  p_notes text,
  p_parsed_description jsonb,
  p_raw_source_payload jsonb
) RETURNS text AS $$
DECLARE
  v_type text;
BEGIN
  -- 1. AI-parsed JD analysis (src/lib/ai/falood/jdAnalyzer.ts) - explicit,
  --    most trustworthy signal.
  v_type := lower(trim(p_parsed_description->>'workplaceType'));
  IF v_type IN ('remote', 'hybrid', 'onsite') THEN
    RETURN v_type;
  END IF;

  -- 2. Crawler-sourced payload (src/lib/integrations/jobCrawler.ts).
  v_type := lower(trim(p_raw_source_payload->>'workplaceType'));
  IF v_type IN ('remote', 'hybrid', 'onsite') THEN
    RETURN v_type;
  END IF;
  IF v_type IN ('on-site', 'on site') THEN
    RETURN 'onsite';
  END IF;

  -- 3. Location text - word-boundary match only, so a real job title/domain
  --    term like "Remote Sensing" never false-positives as remote work.
  IF p_location ~* '\mremote\M' THEN RETURN 'remote'; END IF;
  IF p_location ~* '\mhybrid\M' THEN RETURN 'hybrid'; END IF;
  IF p_location ~* '\mon-?site\M' OR p_location ~* '\min[- ]office\M' THEN RETURN 'onsite'; END IF;

  -- 4. Notes text - catches the from-jd route's flattened "Workplace: <type>."
  --    string and any manually-entered notes mentioning it.
  IF p_notes ~* 'workplace:\s*remote' OR p_notes ~* '\mremote\M' THEN RETURN 'remote'; END IF;
  IF p_notes ~* 'workplace:\s*hybrid' OR p_notes ~* '\mhybrid\M' THEN RETURN 'hybrid'; END IF;
  IF p_notes ~* 'workplace:\s*onsite' OR p_notes ~* '\mon-?site\M' THEN RETURN 'onsite'; END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION jobs_set_work_mode() RETURNS trigger AS $$
BEGIN
  IF NEW.work_mode IS NULL THEN
    NEW.work_mode := infer_job_work_mode(NEW.location, NEW.notes, NEW.parsed_description, NEW.raw_source_payload);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS jobs_infer_work_mode ON jobs;
CREATE TRIGGER jobs_infer_work_mode
  BEFORE INSERT OR UPDATE OF location, notes, parsed_description, raw_source_payload, work_mode ON jobs
  FOR EACH ROW EXECUTE FUNCTION jobs_set_work_mode();

UPDATE jobs
   SET work_mode = infer_job_work_mode(location, notes, parsed_description, raw_source_payload)
 WHERE work_mode IS NULL;

CREATE INDEX IF NOT EXISTS jobs_work_mode_idx ON jobs (work_mode);
