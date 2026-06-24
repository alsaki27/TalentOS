-- Activity-log comments on applications (the "log is a comment" v1 design from the
-- 2026-06-17 planning call) plus a per-candidate magic-link token for the read-only
-- candidate portal.

create table if not exists application_comments (
  id                    uuid primary key default gen_random_uuid(),
  application_id        uuid not null references applications(id) on delete cascade,
  commenter_name        text not null,
  body                  text not null,
  visible_to_candidate  boolean not null default false,
  created_at            timestamptz default now()
);
create index if not exists application_comments_application_created_idx on application_comments (application_id, created_at desc);

alter table candidates
  add column if not exists portal_token uuid not null default gen_random_uuid();

create unique index if not exists candidates_portal_token_idx on candidates (portal_token);
