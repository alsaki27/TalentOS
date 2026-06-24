-- Auth/user foundation for internal Skarion users.
-- Keeps existing free-text assignment fields as fallbacks while adding real user links.

create table if not exists profiles (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  email         text,
  display_name  text not null default '',
  role          text not null default 'recruiter'
    check (role in ('admin', 'manager', 'application_engineer', 'recruiter')),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists profiles_role_idx on profiles (role);
create index if not exists profiles_active_idx on profiles (is_active);

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, email, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(coalesce(new.email, ''), '@', 1), ''),
    coalesce(nullif(new.raw_user_meta_data->>'role', ''), 'recruiter')
  )
  on conflict (user_id) do update
    set email = excluded.email,
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

alter table applications
  add column if not exists assigned_by_user_id uuid references profiles(user_id) on delete set null,
  add column if not exists assigned_to_user_id uuid references profiles(user_id) on delete set null;

create index if not exists applications_assigned_by_user_idx on applications (assigned_by_user_id);
create index if not exists applications_assigned_to_user_idx on applications (assigned_to_user_id);

alter table job_comments
  add column if not exists commenter_user_id uuid references profiles(user_id) on delete set null;

create index if not exists job_comments_commenter_user_idx on job_comments (commenter_user_id);

alter table application_comments
  add column if not exists commenter_user_id uuid references profiles(user_id) on delete set null;

create index if not exists application_comments_commenter_user_idx on application_comments (commenter_user_id);

create table if not exists audit_logs (
  id             uuid primary key default gen_random_uuid(),
  actor_user_id  uuid references profiles(user_id) on delete set null,
  actor_email    text,
  action         text not null,
  entity_type    text not null,
  entity_id      uuid,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists audit_logs_actor_idx on audit_logs (actor_user_id, created_at desc);
create index if not exists audit_logs_entity_idx on audit_logs (entity_type, entity_id, created_at desc);
