-- Remembers confirmed column mappings for the universal job import normalizer so a
-- recurring vendor export doesn't need re-mapping every time.
create table if not exists import_profiles (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  column_map  jsonb not null,
  created_at  timestamptz default now()
);
