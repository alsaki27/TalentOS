-- Add data_summary column to ai_digests for raw numbers alongside AI-formatted content.
-- Stores the exact counts before AI formatting so accuracy can be verified independently.

alter table if exists ai_digests
  add column if not exists data_summary jsonb;
