-- Baseline manager -> application engineer workflow.
-- Applications can now exist before submission as assigned/stacked work tickets.

alter table applications
  add column if not exists assigned_by text,
  add column if not exists assigned_to text,
  add column if not exists assignment_note text,
  add column if not exists assignment_due_at date,
  add column if not exists completed_at timestamptz;

create index if not exists applications_assigned_to_idx on applications (assigned_to);
create index if not exists applications_assignment_due_idx on applications (assignment_due_at);
