-- AI-driven job categorization, salary cleanup, and work-authorization tagging.
-- Replaces the old full-text keyword categorizer (src/lib/jobCategorizer.ts), which
-- scored against the entire description and mis-categorized almost everything that
-- wasn't a clean keyword match (e.g. "Mechanical Design Engineer" -> "Drafting").
--
-- The category list is now a real table, not a hardcoded array, so it can grow
-- (new role types, e.g. mechanical/product design) without a code deploy. Jobs default
-- to category_status='pending' on insert so every import path (CSV, LinkedIn, ATS,
-- career-page, the normalizer pipeline, and the crawler-bot ingestion endpoint, which
-- bypasses src/lib/normalizer/clean.ts entirely) lands in the same queue with no
-- per-route code changes.

create table if not exists job_categories (
  id          uuid primary key default gen_random_uuid(),
  label       text not null unique,
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

insert into job_categories (label, description) values
  ('OSP / Outside Plant Engineering & Design', 'Physical fiber/copper outside plant design, engineering, construction support — ISP/OSP, structured cabling, aerial/underground plant.'),
  ('Fiber & Splicing Technician', 'Hands-on field installation and splicing work — fiber optic/copper splicing, fusion splicing, OTDR testing, cable placement.'),
  ('Network & Telecom Engineering', 'IT-side network engineering and operations — LAN/WAN, network deployment/support, telecom systems engineering, not physical outside plant.'),
  ('CAD / Drafting', 'Drafting as the core function — AutoCAD/MicroStation seat work producing design drawings, as-builts, plan sets, across any engineering domain.'),
  ('GIS / Geospatial', 'Geospatial mapping and analysis — ArcGIS/QGIS, cartography, spatial data work.'),
  ('Civil Engineering / Site Design', 'Civil site design — land development, grading, stormwater, roadway, permitting.'),
  ('Power & Utility Engineering', 'Electric transmission/distribution/substation engineering — PLS-CADD, utility design, power delivery.'),
  ('AV / Low-Voltage / ICT Security Design', 'Audio-visual, low-voltage, and ICT/security systems design and integration.'),
  ('Mechanical / Product Design Engineering', 'Mechanical or product design engineering — consumer hardware, automotive, wire harness, industrial product design, not tied to telecom/utility infrastructure.'),
  ('Project Management / Project Engineering', 'Generic project engineer/project manager roles where the description does not clearly tie to one specific engineering discipline above.'),
  ('Construction / Field Engineering', 'General on-site construction oversight and field engineering, not a design role.')
on conflict (label) do nothing;

alter table jobs
  add column if not exists category_status text not null default 'pending',
  add column if not exists ai_suggested_category text,
  add column if not exists category_error text,
  add column if not exists categorized_at timestamptz,
  add column if not exists category_model text,
  add column if not exists salary_min numeric,
  add column if not exists salary_max numeric,
  add column if not exists salary_currency text,
  add column if not exists salary_period text,
  add column if not exists work_authorization text,
  add column if not exists work_authorization_evidence text;

create index if not exists jobs_category_status_idx on jobs (category_status);
create index if not exists jobs_work_authorization_idx on jobs (work_authorization);

create table if not exists categorization_runs (
  id             uuid primary key default gen_random_uuid(),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  jobs_processed integer not null default 0,
  jobs_failed    integer not null default 0,
  triggered_by   text,
  error          text
);

alter table public.job_categories enable row level security;
alter table public.categorization_runs enable row level security;
