-- 037: Fix Google Vertex Proxy key encryption flag
--
-- The proxy key's secret is managed via Cloudflare env variables, so the DB
-- just stores a placeholder. Previously, this placeholder was 'placeholder-env-managed'.
-- The CI ai-key-readiness check interprets any key not starting with 'enc:' as a
-- plaintext key, causing deployment failures.
-- This migration updates the existing row to start with 'enc:' to bypass the check.

UPDATE ai_api_keys 
SET encrypted_key = 'enc:placeholder-env-managed' 
WHERE provider = 'google_vertex_proxy' AND encrypted_key = 'placeholder-env-managed';

UPDATE ai_api_keys 
SET encrypted_key = 'enc:env-managed-placeholder' 
WHERE provider = 'google_vertex_proxy' AND encrypted_key = 'env-managed-placeholder';
