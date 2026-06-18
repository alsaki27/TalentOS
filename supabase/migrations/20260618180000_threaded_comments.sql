-- Threaded replies on application activity-log comments. Inspired by the comment
-- model in the team's skarion-api backend (job_applications.comments jsonb has a
-- parentId field for replies) — ported as the idea, not the code, onto our existing
-- relational application_comments table instead of a jsonb blob.

alter table application_comments
  add column if not exists parent_comment_id uuid references application_comments(id) on delete cascade;

create index if not exists application_comments_parent_idx on application_comments (parent_comment_id);
