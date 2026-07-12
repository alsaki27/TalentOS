-- Deduplication index: prevent identical notifications for the same user+type+entity
-- within a 24-hour window. The partial index only covers rows newer than 48 hours so
-- it stays small; the application-side WHERE NOT EXISTS enforces the 24h window.
--
-- Safety: this app had no dedup logic before this migration, so it is entirely
-- expected that real, recent (<48h) production rows already violate this
-- uniqueness (e.g. duplicate "overdue" or "new application" notifications
-- fired multiple times for the same entity). CREATE UNIQUE INDEX fails outright
-- if any existing rows conflict - so collapse duplicates first, keeping the
-- oldest row per group (first notification sent wins), before creating the index.

DO $$
BEGIN
  IF EXISTS (
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (
        PARTITION BY user_id, type, COALESCE(entity_type, ''), COALESCE(entity_id, ''), title
        ORDER BY created_at ASC, id ASC
      ) AS rn
      FROM notifications
      WHERE created_at > now() - interval '48 hours'
    )
    SELECT 1 FROM ranked WHERE rn > 1
  ) THEN
    DELETE FROM notifications n
    USING (
      SELECT id, ROW_NUMBER() OVER (
        PARTITION BY user_id, type, COALESCE(entity_type, ''), COALESCE(entity_id, ''), title
        ORDER BY created_at ASC, id ASC
      ) AS rn
      FROM notifications
      WHERE created_at > now() - interval '48 hours'
    ) ranked
    WHERE n.id = ranked.id AND ranked.rn > 1;
  END IF;
END $$;

create unique index if not exists idx_notifications_dedup
  on notifications (user_id, type, coalesce(entity_type, ''), coalesce(entity_id, ''), title)
  where created_at > now() - interval '48 hours';
