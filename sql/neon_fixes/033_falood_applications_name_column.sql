-- 033: Add an explicit, user-editable name to falood_saved_applications.
--
-- Tailored resumes created via the Falood chatbot studio had no name field of
-- their own — the UI derived a display title client-side from the first line
-- of job_description ("Title: ..."), which meant there was nothing to rename.
-- This adds a real column so users can rename a tailored resume independently
-- of its job description text.
ALTER TABLE falood_saved_applications ADD COLUMN IF NOT EXISTS name text;
