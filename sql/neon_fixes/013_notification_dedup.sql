-- Deduplication index: prevent identical notifications for the same user+type+entity.
-- Originally scoped to a partial index (`WHERE created_at > now() - interval '48 hours'`)
-- to stay small, relying on the application-side WHERE NOT EXISTS to enforce the
-- actual 24h dedup window - but Postgres rejects non-IMMUTABLE functions (now())
-- in index predicates outright, so that was never actually valid. Applies to all
-- rows instead; the app-side check still enforces the real 24h semantics, this
-- index is just the hard backstop, so covering all rows is strictly more correct
-- (catches duplicates regardless of age) at the cost of a somewhat larger index.
--
-- Safety: this app had no dedup logic before this migration, so it is entirely
-- expected that real production rows already violate this uniqueness (e.g.
-- duplicate "overdue" or "new application" notifications fired multiple times
-- for the same entity). CREATE UNIQUE INDEX fails outright if any existing
-- rows conflict - so collapse duplicates first, keeping the oldest row per
-- group (first notification sent wins), across the whole table (matching the
-- index's now-unscoped coverage), before creating the index.

DO $$
BEGIN
  IF EXISTS (
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (
        PARTITION BY user_id, type, COALESCE(entity_type, ''), COALESCE(entity_id::text, ''), title
        ORDER BY created_at ASC, id ASC
      ) AS rn
      FROM notifications
    )
    SELECT 1 FROM ranked WHERE rn > 1
  ) THEN
    DELETE FROM notifications n
    USING (
      SELECT id, ROW_NUMBER() OVER (
        PARTITION BY user_id, type, COALESCE(entity_type, ''), COALESCE(entity_id::text, ''), title
        ORDER BY created_at ASC, id ASC
      ) AS rn
      FROM notifications
    ) ranked
    WHERE n.id = ranked.id AND ranked.rn > 1;
  END IF;
END $$;

create unique index if not exists idx_notifications_dedup
  on notifications (user_id, type, coalesce(entity_type, ''), coalesce(entity_id::text, ''), title);
