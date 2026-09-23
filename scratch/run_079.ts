import fs from 'fs';
import { neon } from '@neondatabase/serverless';

const env = fs.readFileSync('.env.local', 'utf8');
const dbUrlMatch = env.match(/DATABASE_URL=(.+)/);
if (!dbUrlMatch) throw new Error("No DATABASE_URL found");
const dbUrl = dbUrlMatch[1].trim();

const sqlQuery = fs.readFileSync('sql/neon_fixes/079_inbox_drafts_and_handover.sql', 'utf8');
const sql = neon(dbUrl);

async function main() {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS inbox_drafts (
      id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email_communication_id uuid REFERENCES email_communications(id) ON DELETE CASCADE,
      candidate_id           uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      created_by             uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
      to_email               text NOT NULL,
      subject                text NOT NULL,
      body                   text NOT NULL,
      attachment_metadata    jsonb NOT NULL DEFAULT '[]',
      gmail_draft_id         text,
      gmail_thread_id        text,
      sent_at                timestamptz,
      discarded_at           timestamptz,
      created_at             timestamptz NOT NULL DEFAULT now(),
      updated_at             timestamptz NOT NULL DEFAULT now()
    )
  `);
  await sql.query(`CREATE INDEX IF NOT EXISTS inbox_drafts_candidate_idx ON inbox_drafts (candidate_id, created_at DESC)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS inbox_drafts_unsent_idx ON inbox_drafts (candidate_id) WHERE sent_at IS NULL AND discarded_at IS NULL`);
  console.log("SQL executed successfully.");
}

main().catch(console.error);
