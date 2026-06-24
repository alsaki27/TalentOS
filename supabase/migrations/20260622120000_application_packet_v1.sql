-- supabase/migrations/20260622120000_application_packet_v1.sql
-- Chunk 10: Application Packet Builder — extends existing application_packets table.
-- Portable Postgres; uses ALTER TABLE add column if not exists.

BEGIN;

-- ============================================================
-- 1. ADD MISSING COLUMNS TO application_packets
-- ============================================================

ALTER TABLE application_packets
  ADD COLUMN IF NOT EXISTS packet_status        text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS resume_export_id     uuid REFERENCES application_resume_exports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS final_notes          text,
  ADD COLUMN IF NOT EXISTS checklist            jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS warnings             jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS ai_summary          jsonb,
  ADD COLUMN IF NOT EXISTS reviewed_by         uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_by         uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sent_by             uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at         timestamptz,
  ADD COLUMN IF NOT EXISTS approved_at         timestamptz,
  ADD COLUMN IF NOT EXISTS sent_at             timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at          timestamptz DEFAULT now();

-- Constraint: packet_status values
ALTER TABLE application_packets
  DROP CONSTRAINT IF EXISTS application_packets_status_check;
ALTER TABLE application_packets
  ADD CONSTRAINT application_packets_status_check CHECK (
    packet_status IN ('draft', 'ready_for_review', 'approved', 'sent', 'archived')
  );

-- ============================================================
-- 2. INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_application_packets_status
  ON application_packets(packet_status);
CREATE INDEX IF NOT EXISTS idx_application_packets_resume_export_id
  ON application_packets(resume_export_id);
CREATE INDEX IF NOT EXISTS idx_application_packets_created_at
  ON application_packets(created_at);

-- ============================================================
-- 3. TRIGGER: updated_at auto-timestamp
-- ============================================================

CREATE OR REPLACE FUNCTION update_application_packets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_application_packets_updated_at ON application_packets;
CREATE TRIGGER trg_application_packets_updated_at
  BEFORE UPDATE ON application_packets
  FOR EACH ROW
  EXECUTE FUNCTION update_application_packets_updated_at();

COMMIT;
