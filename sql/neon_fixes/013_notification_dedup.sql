-- Deduplication index: prevent identical notifications for the same user+type+entity
-- within a 24-hour window. The partial index only covers rows newer than 48 hours so
-- it stays small; the application-side WHERE NOT EXISTS enforces the 24h window.

create unique index if not exists idx_notifications_dedup
  on notifications (user_id, type, coalesce(entity_type, ''), coalesce(entity_id, ''), title)
  where created_at > now() - interval '48 hours';
