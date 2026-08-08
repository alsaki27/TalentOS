-- BaseResume_TO_JobSearchKeyword: AI-generated, human-reviewable search contracts.
-- Keywords remain intentionally capped below 50 so ingestion stays focused.

ALTER TABLE candidate_resume_search_profiles
  ADD COLUMN IF NOT EXISTS keyword_states jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS generation_status text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS last_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_generation_model text,
  ADD COLUMN IF NOT EXISTS last_generation_prompt_version text,
  ADD COLUMN IF NOT EXISTS last_generation_error text;

CREATE TABLE IF NOT EXISTS base_resume_keyword_agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  base_resume_id uuid NOT NULL REFERENCES base_resumes(id) ON DELETE CASCADE,
  trigger_type text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'started',
  model text,
  provider text,
  prompt_version text,
  input_snapshot jsonb,
  output_snapshot jsonb,
  error_message text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS base_resume_keyword_agent_runs_resume_idx
  ON base_resume_keyword_agent_runs(base_resume_id, created_at DESC);

INSERT INTO ai_automations (id, label, description, group_label, is_active)
VALUES (
  'BaseResume_TO_JobSearchKeyword',
  'BaseResume_TO_JobSearchKeyword',
  'Builds a focused, evidence-grounded job-search keyword and rule contract for every base resume, capped below 50 keywords and held for manager review.',
  'Base Resumes',
  true
)
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  group_label = EXCLUDED.group_label,
  is_active = true;

INSERT INTO ai_agent_configs
  (automation_id, display_name, system_prompt, prompt_version, output_schema_version, temperature, max_output_tokens, timeout_ms, max_attempts, approval_policy, minimum_score, is_active)
VALUES (
  'BaseResume_TO_JobSearchKeyword',
  'BaseResume_TO_JobSearchKeyword',
  $$You are BaseResume_TO_JobSearchKeyword. Build a focused job-search contract from one candidate base resume.

Evidence policy:
- Use the base resume, education, target roles, and target industry as the source of truth.
- Never invent a certification, software skill, license, industry, responsibility, or achievement.
- You may include a reasonable title synonym or adjacent entry-level title when the degree, experience, and transferable work make the connection defensible.
- Do not confuse a search keyword with a resume claim: a title can be a discovery term, but the rules must prevent false-positive roles.

Output exactly one JSON object with this shape:
{"keywords":[{"term":"...","category":"title|skill|tool|domain|work_product","evidence":"direct|transferable|adjacent","reason":"short evidence-based reason"}],"additional_rules":["short rule"]}

Formatting policy:
- Return one complete object; never truncate the response.
- Keep every string short, single-line, and free of unescaped quotes or line breaks.
- Do not include markdown fences, comments, trailing commas, or text before or after the object.

Keyword policy:
- Return 30–48 unique, high-signal terms; never more than 48.
- Start with the most useful job titles, then the core tools, domains, work products, and commonly used title aliases.
- Prefer terms recruiters and job boards actually use. Avoid generic terms such as engineer, professional, communication, Microsoft Office, or problem solving unless they are part of a meaningful title/phrase.
- Do not fill space with minor synonyms. Consolidate near-duplicates.
- For a broad transferable profile, include adjacent titles only when the rules clearly describe the boundary.

Rules policy:
- Return 4–8 practical rules covering experience level, licenses/certifications, location/relocation, core-fit requirements, and false-positive exclusions.
- Rules must be usable by a future ingestion pipeline and readable by a human reviewer.
- Keep rules precise: say what to reject, what to prefer, and which secondary tools are acceptable without treating them as proven experience.
- Treat candidate-specific constraints from the resume/profile as binding; do not invent constraints.

Return JSON only. No markdown, no explanation outside the JSON.$$,
  'v1.1',
  'BaseResumeJobSearchKeywordV1',
  0.2,
  5000,
  45000,
  2,
  'always_human',
  0,
  true
)
ON CONFLICT (automation_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  system_prompt = EXCLUDED.system_prompt,
  prompt_version = EXCLUDED.prompt_version,
  output_schema_version = EXCLUDED.output_schema_version,
  temperature = EXCLUDED.temperature,
  max_output_tokens = EXCLUDED.max_output_tokens,
  timeout_ms = EXCLUDED.timeout_ms,
  max_attempts = EXCLUDED.max_attempts,
  approval_policy = EXCLUDED.approval_policy,
  is_active = true,
  updated_at = NOW();

INSERT INTO ai_automation_routes (automation_id, provider, rank, is_enabled, model_override)
VALUES
  ('BaseResume_TO_JobSearchKeyword', 'google_vertex_proxy', 1, true, 'gemini-2.5-pro'),
  ('BaseResume_TO_JobSearchKeyword', 'google_vertex_proxy', 99, true, 'gemini-2.5-pro')
ON CONFLICT (automation_id, rank) DO UPDATE SET
  provider = EXCLUDED.provider,
  is_enabled = true,
  model_override = EXCLUDED.model_override,
  updated_at = NOW();

-- Bhaskar's hand-seeded 131/138-keyword profiles were cleared when this
-- migration was first applied. Do not delete profiles here: deploy reruns all
-- files in this directory, and an unconditional delete would erase manager
-- review work on every future deploy.
