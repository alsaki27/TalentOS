-- Adds real, code-enforced deletion protection for AI keys instead of relying
-- purely on convention/instructions (e.g. "never delete Rianv1"). Used first
-- for the env-managed Google Vertex Proxy key, whose actual secret material
-- lives in Cloudflare Worker secrets (GOOGLE_VERTEX_PROXY_SECRET etc.), not in
-- this table — deleting the DB row would silently break every automation
-- routed to it with no way to recover the row's routing history.
ALTER TABLE ai_api_keys ADD COLUMN IF NOT EXISTS is_protected boolean NOT NULL DEFAULT false;
