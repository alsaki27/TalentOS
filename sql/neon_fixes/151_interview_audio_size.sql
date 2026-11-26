-- Interview recordings have a separate per-file limit from preparation documents.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE interview_preparation_files
  DROP CONSTRAINT interview_preparation_files_size_bytes_check,
  ADD CONSTRAINT interview_preparation_files_size_bytes_check CHECK (
    size_bytes BETWEEN 1 AND CASE WHEN content_type LIKE 'audio/%' THEN 314572800 ELSE 20971520 END
  );
COMMIT;
