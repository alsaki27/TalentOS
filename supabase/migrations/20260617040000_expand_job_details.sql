-- Store the full LinkedIn scraper payload fields we care about on jobs.
-- Keep raw_source_payload as an escape hatch for scraper fields we have not promoted yet.

alter table jobs
  add column if not exists external_job_id text,
  add column if not exists tracking_id text,
  add column if not exists ref_id text,
  add column if not exists apply_url text,
  add column if not exists description_html text,
  add column if not exists description_text text,
  add column if not exists benefits jsonb,
  add column if not exists job_function text,
  add column if not exists industries text,
  add column if not exists input_url text,
  add column if not exists company_linkedin_url text,
  add column if not exists company_logo_url text,
  add column if not exists company_address jsonb,
  add column if not exists company_slogan text,
  add column if not exists company_description text,
  add column if not exists job_poster_name text,
  add column if not exists job_poster_title text,
  add column if not exists job_poster_profile_url text,
  add column if not exists job_poster_photo_url text,
  add column if not exists raw_source_payload jsonb;

create index if not exists jobs_external_job_id_idx on jobs (external_job_id);
