-- sql/06_ai_key_manager_v2.sql seeds all 18 ai_automations rows (the 14
-- non-pipeline ones below, plus the 4 application-pipeline ones), but lives
-- in sql/ (assumed applied historically/manually), not sql/neon_fixes/ (the
-- only directory this deploy pipeline actually auto-applies) - so it was
-- never actually run. Only the 4 pipeline automations exist in production
-- (seeded separately by 008_workflow_recovery.sql, which IS in this
-- directory), even though ai_api_keys/ai_automations/ai_automation_routes/
-- ai_usage_events/ai_usage_daily themselves clearly already exist (the
-- pipeline works, keys route, usage gets tracked) - just this specific seed
-- data was skipped. Confirmed live: Admin UI only ever showed 4 automations.

insert into ai_automations (id, label, description, group_label) values
  ('resume_parsing',        'Resume Parsing',            'Extract structured fields from uploaded PDF/DOCX resumes', 'Parsing & Extraction'),
  ('candidate_markitdown',  'Candidate Doc Import',       'Parse candidate profile docs via markitdown',              'Parsing & Extraction'),
  ('jd_analysis',           'JD Analysis',                'Extract structured requirements from job descriptions',    'Parsing & Extraction'),
  ('job_categorization',    'Job Categorization',         'Auto-categorize imported jobs',                            'Parsing & Extraction'),
  ('keyword_extraction',    'Application Keywords',       'Generate JD keywords for an application',                  'Parsing & Extraction'),
  ('evidence_mapping',      'Evidence Mapping',           'AI-assisted fallback for mapping keywords to evidence',    'Parsing & Extraction'),
  ('target_jobs_matching',  'Target Jobs Matching',       'Match candidate profile to target job criteria',           'Parsing & Extraction'),
  ('base_resume_studio',    'Base Resume Studio',         'CLI-style base resume editing commands',                   'Resume Studio'),
  ('application_tailoring', 'Application Tailoring',      'Tailor resume content to a specific application',          'Resume Studio'),
  ('resume_suggestions',    'Resume Suggestions',         'Suggest resume improvements from approved keywords',       'Resume Studio'),
  ('cover_letter_gen',      'Cover Letter Generation',    'Generate cover letters',                                   'Content Generation'),
  ('recruiter_message_gen', 'Recruiter Message Generation','Generate recruiter outreach messages',                    'Content Generation'),
  ('ai_digest',             'Daily/Weekly Digest',        'Summarize pipeline activity',                              'Content Generation'),
  ('chat_assistant',        'Chat Assistant',             'Interactive assistant with read-only data tools',          'Assistant')
on conflict (id) do nothing;
