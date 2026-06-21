CREATE SEQUENCE IF NOT EXISTS applications_app_number_seq START WITH 10000;

-- Only add column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'applications' AND column_name = 'app_number'
    ) THEN
        ALTER TABLE applications ADD COLUMN app_number INTEGER UNIQUE;
        ALTER TABLE applications ALTER COLUMN app_number SET DEFAULT nextval('applications_app_number_seq');
    END IF;
END $$;
