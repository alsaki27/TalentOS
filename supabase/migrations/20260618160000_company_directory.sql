create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null unique,
  slug text,
  website text,
  linkedin_url text,
  logo_url text,
  employees_count integer,
  address jsonb,
  slogan text,
  description text,
  notes text,
  source text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists companies_name_idx on companies (name);
create index if not exists companies_last_seen_idx on companies (last_seen_at desc);

create table if not exists company_people (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  full_name text not null,
  normalized_name text not null,
  title text,
  linkedin_url text,
  photo_url text,
  email text,
  phone text,
  influence_level text not null default 'unknown'
    check (influence_level in ('unknown', 'recruiter', 'hiring_manager', 'manager', 'executive')),
  relationship_status text not null default 'new'
    check (relationship_status in ('new', 'contacted', 'replied', 'warm', 'do_not_contact')),
  notes text,
  source text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists company_people_company_idx on company_people (company_id, last_seen_at desc);
create index if not exists company_people_linkedin_idx on company_people (linkedin_url);
create unique index if not exists company_people_company_profile_unique_idx
  on company_people (company_id, linkedin_url)
  where linkedin_url is not null;

alter table jobs
  add column if not exists company_id uuid references companies(id) on delete set null;

create index if not exists jobs_company_id_idx on jobs (company_id);

insert into companies (
  name, normalized_name, slug, website, linkedin_url, logo_url, employees_count,
  address, slogan, description, source, first_seen_at, last_seen_at
)
select
  max(company),
  lower(regexp_replace(trim(company), '[^a-zA-Z0-9]+', ' ', 'g')),
  lower(regexp_replace(max(trim(company)), '[^a-zA-Z0-9]+', '-', 'g')),
  max(company_website),
  max(company_linkedin_url),
  max(company_logo_url),
  max(company_employees_count),
  max(company_address::text)::jsonb,
  max(company_slogan),
  max(company_description),
  max(source),
  min(created_at),
  max(coalesce(last_seen_at, created_at))
from jobs
where company is not null and trim(company) <> ''
group by lower(regexp_replace(trim(company), '[^a-zA-Z0-9]+', ' ', 'g'))
on conflict (normalized_name) do update set
  website = coalesce(companies.website, excluded.website),
  linkedin_url = coalesce(companies.linkedin_url, excluded.linkedin_url),
  logo_url = coalesce(companies.logo_url, excluded.logo_url),
  employees_count = coalesce(companies.employees_count, excluded.employees_count),
  address = coalesce(companies.address, excluded.address),
  slogan = coalesce(companies.slogan, excluded.slogan),
  description = coalesce(companies.description, excluded.description),
  source = coalesce(companies.source, excluded.source),
  last_seen_at = greatest(companies.last_seen_at, excluded.last_seen_at),
  updated_at = now();

update jobs
set company_id = companies.id
from companies
where jobs.company_id is null
  and jobs.company is not null
  and companies.normalized_name = lower(regexp_replace(trim(jobs.company), '[^a-zA-Z0-9]+', ' ', 'g'));

insert into company_people (
  company_id, full_name, normalized_name, title, linkedin_url, photo_url,
  influence_level, source, first_seen_at, last_seen_at
)
select
  companies.id,
  jobs.job_poster_name,
  lower(regexp_replace(trim(jobs.job_poster_name), '[^a-zA-Z0-9]+', ' ', 'g')),
  max(jobs.job_poster_title),
  max(jobs.job_poster_profile_url),
  max(jobs.job_poster_photo_url),
  case
    when max(jobs.job_poster_title) ilike '%recruit%' then 'recruiter'
    when max(jobs.job_poster_title) ilike '%hiring%' then 'hiring_manager'
    when max(jobs.job_poster_title) ilike '%manager%' then 'manager'
    when max(jobs.job_poster_title) ilike '%director%' or max(jobs.job_poster_title) ilike '%vp%' then 'executive'
    else 'unknown'
  end,
  max(jobs.source),
  min(jobs.created_at),
  max(coalesce(jobs.last_seen_at, jobs.created_at))
from jobs
join companies on companies.id = jobs.company_id
where jobs.job_poster_name is not null and trim(jobs.job_poster_name) <> ''
group by companies.id, jobs.job_poster_name, lower(regexp_replace(trim(jobs.job_poster_name), '[^a-zA-Z0-9]+', ' ', 'g'))
on conflict do nothing;

alter table public.companies enable row level security;
alter table public.company_people enable row level security;
