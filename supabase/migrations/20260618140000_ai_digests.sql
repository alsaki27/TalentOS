-- Daily AI-generated activity digest — single-shot generation (app gathers the data,
-- one prompt, one response), not the multi-turn tool-calling pattern /chat uses. See
-- ROADMAP.md for why that distinction matters: the latter degenerates unreliably with
-- the NVIDIA-hosted model under live testing; the former does not.

create table if not exists ai_digests (
  id            uuid primary key default gen_random_uuid(),
  content       text not null,
  provider      text not null,
  generated_at  timestamptz not null default now()
);
create index if not exists ai_digests_generated_idx on ai_digests (generated_at desc);
