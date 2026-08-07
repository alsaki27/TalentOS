-- 054: Copilot Cover Letter agent + generated-letter storage.
-- Runs on gemini-2.5-pro (not flash-lite like the rest of the Copilot team) —
-- this is real generated prose that goes in front of a hiring manager, not a
-- classification/policy call, so it gets the higher-quality model.
--
-- The actual PDF is rendered client-side in the extension via jsPDF (the same
-- library already used by Falood Studio's resume export — see
-- src/lib/falood/skarionPdfDocument.tsx and clientExport.tsx — since
-- @react-pdf/renderer's server-side path was confirmed too heavy for the
-- Cloudflare Worker script bundle). This table stores the generated letter
-- TEXT only; no file lives in the DB.

INSERT INTO ai_automations (id, label, description, group_label, is_active)
VALUES ('copilot_cover_letter', 'Copilot Cover Letter', 'Drafts a 1-page cover letter from the tailored resume, candidate info, and job description', 'Application Copilot', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ai_agent_configs (automation_id, display_name, is_active)
VALUES ('copilot_cover_letter', 'Copilot Cover Letter', true)
ON CONFLICT (automation_id) DO NOTHING;

INSERT INTO ai_automation_routes (automation_id, provider, rank, is_enabled, model_override)
VALUES
  ('copilot_cover_letter', 'google_vertex_proxy', 1, true, 'gemini-2.5-pro'),
  ('copilot_cover_letter', 'google_vertex_proxy', 99, true, 'gemini-2.5-pro')
ON CONFLICT (automation_id, rank) DO NOTHING;

CREATE TABLE IF NOT EXISTS copilot_cover_letters (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  candidate_id    uuid REFERENCES candidates(id) ON DELETE SET NULL,
  letter_text     text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id)
);
