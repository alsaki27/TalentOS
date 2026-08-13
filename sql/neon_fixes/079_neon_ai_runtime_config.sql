-- Neon is the canonical control plane for AI provider connections and routing.
-- Provider credentials remain encrypted in ai_api_keys.encrypted_key; this JSON
-- column stores non-secret connection metadata that operators need to inspect.
ALTER TABLE ai_api_keys
  ADD COLUMN IF NOT EXISTS provider_config jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS ai_runtime_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton = true),
  active_routing_state_id uuid REFERENCES ai_routing_states(id) ON DELETE SET NULL,
  allow_unrouted_fallback boolean NOT NULL DEFAULT false,
  workflow_max_concurrency integer NOT NULL DEFAULT 5
    CHECK (workflow_max_concurrency BETWEEN 1 AND 25),
  workflow_claim_ttl_seconds integer NOT NULL DEFAULT 420
    CHECK (workflow_claim_ttl_seconds BETWEEN 120 AND 1800),
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO ai_runtime_config (singleton, active_routing_state_id)
SELECT true, id
FROM ai_routing_states
WHERE status = 'published'
ORDER BY published_at DESC NULLS LAST, updated_at DESC
LIMIT 1
ON CONFLICT (singleton) DO NOTHING;

INSERT INTO ai_automations (id, label, description, group_label, is_active)
VALUES (
  'candidate_source_of_truth',
  'Candidate Source of Truth',
  'Extracts verified candidate profile facts and professional skills from base resumes.',
  'Candidate Intelligence',
  true
)
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  group_label = EXCLUDED.group_label,
  is_active = true;

INSERT INTO ai_automation_routes (automation_id, ai_key_id, provider, rank, is_enabled, model_override)
SELECT 'candidate_source_of_truth', k.id, NULL, 1, true, 'coding-cheap'
FROM ai_api_keys k
WHERE k.provider = 'google_vertex_proxy' AND k.is_enabled = true
ORDER BY k.priority, k.created_at
LIMIT 1
ON CONFLICT (automation_id, rank) DO UPDATE SET
  ai_key_id = EXCLUDED.ai_key_id,
  provider = NULL,
  model_override = EXCLUDED.model_override,
  is_enabled = true;
