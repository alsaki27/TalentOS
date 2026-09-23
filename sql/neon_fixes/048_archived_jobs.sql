-- Create archived_jobs table with the exact same structure as jobs
CREATE TABLE IF NOT EXISTS archived_jobs (
    LIKE jobs INCLUDING ALL
);
