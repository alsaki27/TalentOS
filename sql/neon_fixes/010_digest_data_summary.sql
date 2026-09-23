-- Add data_summary column to ai_digests for raw numbers alongside AI-formatted content.
-- Stores the exact counts before AI formatting so accuracy can be verified independently.

ALTER TABLE IF EXISTS ai_digests ADD COLUMN IF NOT EXISTS data_summary jsonb;
