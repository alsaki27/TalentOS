-- Versioned, additive routing-state catalog. States are snapshots only until
-- the resolver explicitly opts into one; existing live routing is unchanged.
CREATE TABLE IF NOT EXISTS ai_routing_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

CREATE TABLE IF NOT EXISTS ai_routing_state_routes (
  state_id uuid NOT NULL REFERENCES ai_routing_states(id) ON DELETE CASCADE,
  automation_id text NOT NULL REFERENCES ai_automations(id) ON DELETE CASCADE,
  rank integer NOT NULL,
  ai_key_id uuid REFERENCES ai_api_keys(id) ON DELETE SET NULL,
  provider text,
  model_override text,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (state_id, automation_id, rank),
  CHECK (rank >= 1),
  CHECK (ai_key_id IS NOT NULL OR provider IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS ai_routing_state_routes_state_idx
  ON ai_routing_state_routes(state_id, automation_id, rank);

-- Capture today's live configuration exactly once. Publishing this snapshot is
-- metadata-only today and therefore cannot interrupt current agent execution.
INSERT INTO ai_routing_states (name, description, status, published_at)
VALUES ('Gemini Regular 8.12', 'Baseline Vertex routing captured on 2026-08-12.', 'published', now())
ON CONFLICT (name) DO NOTHING;

INSERT INTO ai_routing_state_routes
  (state_id, automation_id, rank, ai_key_id, provider, model_override, is_enabled)
SELECT s.id, r.automation_id, r.rank, r.ai_key_id, r.provider, r.model_override, r.is_enabled
FROM ai_routing_states s
JOIN ai_automation_routes r ON true
WHERE s.name = 'Gemini Regular 8.12'
  AND NOT EXISTS (
    SELECT 1 FROM ai_routing_state_routes x
    WHERE x.state_id = s.id
      AND x.automation_id = r.automation_id
      AND x.rank = r.rank
  );
