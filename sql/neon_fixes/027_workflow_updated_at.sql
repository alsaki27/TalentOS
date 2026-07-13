-- 027: application_ai_workflows never had an updated_at column, but 026's
-- index and the new /api/application-ai-workflows/active polling query both
-- reference w.updated_at (order-by and index predicate) - both would 500 on
-- "column updated_at does not exist" without this. Confirmed live: neither
-- 026's own index creation nor the route's SELECT can run against the
-- current schema.
ALTER TABLE application_ai_workflows
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
