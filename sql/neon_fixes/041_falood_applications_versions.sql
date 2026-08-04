-- 041: Add a versions jsonb column to falood_saved_applications to support version control

ALTER TABLE falood_saved_applications ADD COLUMN IF NOT EXISTS versions jsonb DEFAULT '[]'::jsonb;
