-- Lock direct anon/authenticated table access. The app uses server-side API routes
-- with the service role key, which bypasses RLS. Candidate portal access also goes
-- through server API routes, so no public table policy is required yet.

alter table public.application_comments enable row level security;
alter table public.application_events enable row level security;
alter table public.applications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.candidates enable row level security;
alter table public.import_profiles enable row level security;
alter table public.job_comments enable row level security;
alter table public.jobs enable row level security;
alter table public.profiles enable row level security;
alter table public.resumes enable row level security;
