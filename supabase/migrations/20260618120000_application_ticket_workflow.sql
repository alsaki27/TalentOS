-- Ticket workflow metadata for the application engineer queue.

alter table applications
  add column if not exists priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  add column if not exists review_status text not null default 'not_required'
    check (review_status in ('not_required', 'pending', 'approved', 'changes_requested')),
  add column if not exists review_note text,
  add column if not exists reviewed_by_user_id uuid references profiles(user_id) on delete set null,
  add column if not exists reviewed_at timestamptz;

create index if not exists applications_priority_idx on applications (priority);
create index if not exists applications_review_status_idx on applications (review_status);
