-- 048: Additional candidate fields needed for the application-autofill extension.
-- Additive only (IF NOT EXISTS), idempotent, matches the pattern in alter_eeo.ts.
-- Salary/veteran/disability/visa/work-auth already exist as salary_expectation,
-- eeo_veteran, eeo_disability, visa_status, work_authorization — not duplicated here.

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS home_address text,              -- full street address incl. zip
  ADD COLUMN IF NOT EXISTS birth_date date,
  ADD COLUMN IF NOT EXISTS open_to_relocation boolean,
  ADD COLUMN IF NOT EXISTS driving_license text,            -- e.g. 'No', 'Yes - Class E', 'Yes - Regular'
  ADD COLUMN IF NOT EXISTS driving_license_state text,
  ADD COLUMN IF NOT EXISTS driving_license_expiry date,
  ADD COLUMN IF NOT EXISTS pe_license_il text,               -- active IL P.E. license: 'Yes' / 'No'
  ADD COLUMN IF NOT EXISTS education_gpa text,
  ADD COLUMN IF NOT EXISTS education_gpa_year integer;
