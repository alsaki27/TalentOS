-- Candidate profile picture, shown as a circle avatar on the jobs masterlist.
alter table candidates
  add column if not exists avatar_url text;
