-- Seed missing application pipeline automations that are called via
-- callWithUsageTracking in applicationAiWorkflowService.ts but were not
-- seeded in 06_ai_key_manager_v2.sql.

insert into ai_automations (id, label, description, group_label) values
  ('application_job_lens',      'Job Lens',                'Analyze a job description and extract structured requirements for application pipeline', 'Application Pipeline'),
  ('application_resume_forge',  'Resume Forge',            'Draft a tailored resume from base content and job requirements',                      'Application Pipeline'),
  ('application_hiring_panel',  'Hiring Panel Review',     'Simulate a hiring panel review of the tailored resume',                              'Application Pipeline'),
  ('application_final_polish',  'Final Polish',            'Polish and finalize resume content before delivery',                                 'Application Pipeline')
on conflict (id) do nothing;

-- Workflow lease/recovery columns for safe concurrent dispatch
ALTER TABLE application_ai_workflows ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE application_ai_workflows ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz;
ALTER TABLE application_ai_workflows ADD COLUMN IF NOT EXISTS claimed_by text;
ALTER TABLE application_ai_workflows ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz;
ALTER TABLE application_ai_workflows ADD COLUMN IF NOT EXISTS lock_version int NOT NULL DEFAULT 0;
ALTER TABLE application_ai_workflows ADD COLUMN IF NOT EXISTS recovery_count int NOT NULL DEFAULT 0;
