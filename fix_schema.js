#!/usr/bin/env node
const { neon } = require("@neondatabase/serverless");
const url = "postgresql://neondb_owner:npg_Gj1bqgAwf0mE@ep-withered-leaf-at0ubn6s-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
const sql = neon(url, { fetchOptions: { cache: "no-store" } });

async function fix() {
  console.log("Fixing remaining schema issues...");
  
  // 1. Create application_packets table (without FK to application_resume_exports for now)
  try {
    await sql(`
      CREATE TABLE IF NOT EXISTS application_packets (
        application_id            uuid PRIMARY KEY REFERENCES applications(id) ON DELETE CASCADE,
        resume_version_id         uuid REFERENCES application_resume_versions(id) ON DELETE SET NULL,
        resume_export_id          uuid REFERENCES application_resume_exports(id) ON DELETE SET NULL,
        cover_letter_version_id   uuid REFERENCES application_resume_versions(id) ON DELETE SET NULL,
        cover_letter_export_id    uuid REFERENCES application_resume_exports(id) ON DELETE SET NULL,
        packet_status             text NOT NULL DEFAULT 'draft',
        packet_pdf_url            text,
        notes                     text,
        created_at                timestamptz NOT NULL DEFAULT now(),
        updated_at                timestamptz NOT NULL DEFAULT now()
      );
    `);
    console.log("OK application_packets table");
  } catch (e) {
    console.error("ERR application_packets:", e.message?.substring(0, 120));
  }
  
  // 2. Add indexes for application_packets
  const packetIndexes = [
    "CREATE INDEX IF NOT EXISTS idx_application_packets_status ON application_packets (packet_status);",
    "CREATE INDEX IF NOT EXISTS idx_application_packets_resume_export_id ON application_packets (resume_export_id);",
    "CREATE INDEX IF NOT EXISTS idx_application_packets_created_at ON application_packets (created_at DESC);",
  ];
  for (const idx of packetIndexes) {
    try { await sql(idx); console.log("OK", idx.substring(0, 60)); }
    catch (e) { console.error("ERR", e.message?.substring(0, 80)); }
  }
  
  // 3. Add CHECK constraint for application_packets
  try {
    await sql(`ALTER TABLE application_packets ADD CONSTRAINT IF NOT EXISTS application_packets_status_check CHECK (packet_status IN ('draft', 'review', 'approved', 'sent'));`);
    console.log("OK application_packets status check");
  } catch (e) {
    console.error("ERR status check:", e.message?.substring(0, 80));
  }
  
  // 4. Create set_updated_at function
  try {
    await sql(`
      CREATE OR REPLACE FUNCTION set_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    console.log("OK set_updated_at function");
  } catch (e) {
    console.error("ERR set_updated_at:", e.message?.substring(0, 120));
  }
  
  // 5. Create triggers using the function
  const triggers = [
    "CREATE TRIGGER IF NOT EXISTS company_people_updated_at BEFORE UPDATE ON company_people FOR EACH ROW EXECUTE FUNCTION set_updated_at();",
    "CREATE TRIGGER IF NOT EXISTS job_crawler_status_updated_at BEFORE UPDATE ON job_crawler_status FOR EACH ROW EXECUTE FUNCTION set_updated_at();",
    "CREATE TRIGGER IF NOT EXISTS public_api_keys_updated_at BEFORE UPDATE ON public_api_keys FOR EACH ROW EXECUTE FUNCTION set_updated_at();",
    "CREATE TRIGGER IF NOT EXISTS application_job_keywords_updated_at BEFORE UPDATE ON application_job_keywords FOR EACH ROW EXECUTE FUNCTION set_updated_at();",
    "CREATE TRIGGER IF NOT EXISTS ai_api_keys_updated_at BEFORE UPDATE ON ai_api_keys FOR EACH ROW EXECUTE FUNCTION set_updated_at();",
    "CREATE TRIGGER IF NOT EXISTS application_resume_suggestions_updated_at BEFORE UPDATE ON application_resume_suggestions FOR EACH ROW EXECUTE FUNCTION set_updated_at();",
    "CREATE TRIGGER IF NOT EXISTS application_packets_updated_at BEFORE UPDATE ON application_packets FOR EACH ROW EXECUTE FUNCTION set_updated_at();",
  ];
  for (const trig of triggers) {
    try { await sql(trig); console.log("OK trigger:", trig.substring(0, 60)); }
    catch (e) { console.error("ERR trigger:", e.message?.substring(0, 80)); }
  }
  
  // 6. Create get_funnel_counts function (for analytics)
  try {
    await sql(`
      CREATE OR REPLACE FUNCTION get_funnel_counts(
        date_from timestamptz DEFAULT NULL,
        date_to timestamptz DEFAULT NULL
      )
      RETURNS TABLE(stage text, count bigint) AS $$
      BEGIN
        RETURN QUERY
        SELECT 'sourced'::text, COUNT(*)::bigint FROM jobs
        WHERE (date_from IS NULL OR created_at >= date_from)
          AND (date_to IS NULL OR created_at <= date_to);
        
        RETURN QUERY
        SELECT 'applied'::text, COUNT(*)::bigint FROM applications
        WHERE (date_from IS NULL OR applied_at >= date_from)
          AND (date_to IS NULL OR applied_at <= date_to);
        
        RETURN QUERY
        SELECT 'interviewed'::text, COUNT(*)::bigint FROM applications
        WHERE status IN ('interviewed', 'in_progress', 'stacked')
          AND (date_from IS NULL OR applied_at >= date_from)
          AND (date_to IS NULL OR applied_at <= date_to);
        
        RETURN QUERY
        SELECT 'offered'::text, COUNT(*)::bigint FROM applications
        WHERE status IN ('offer', 'hired', 'placed')
          AND (date_from IS NULL OR applied_at >= date_from)
          AND (date_to IS NULL OR applied_at <= date_to);
        
        RETURN QUERY
        SELECT 'hired'::text, COUNT(*)::bigint FROM applications
        WHERE status IN ('hired', 'placed')
          AND (date_from IS NULL OR applied_at >= date_from)
          AND (date_to IS NULL OR applied_at <= date_to);
      END;
      $$ LANGUAGE plpgsql;
    `);
    console.log("OK get_funnel_counts function");
  } catch (e) {
    console.error("ERR get_funnel_counts:", e.message?.substring(0, 120));
  }
  
  // 7. Add auth columns to profiles (for auth migration)
  const authColumns = [
    "ALTER TABLE profiles ADD COLUMN IF NOT EXISTS password_hash TEXT;",
    "ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;",
    "ALTER TABLE profiles ADD COLUMN IF NOT EXISTS verification_token TEXT;",
    "ALTER TABLE profiles ADD COLUMN IF NOT EXISTS verification_token_expires_at TIMESTAMPTZ;",
    "ALTER TABLE profiles ADD COLUMN IF NOT EXISTS reset_token TEXT;",
    "ALTER TABLE profiles ADD COLUMN IF NOT EXISTS reset_token_expires_at TIMESTAMPTZ;",
    "ALTER TABLE profiles ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0;",
    "ALTER TABLE profiles ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;",
  ];
  for (const col of authColumns) {
    try { await sql(col); console.log("OK auth column:", col.substring(0, 60)); }
    catch (e) { console.error("ERR auth column:", e.message?.substring(0, 80)); }
  }
  
  // 8. Verify
  const result = await sql("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;");
  console.log("\nTables:", result.length);
  const hasPackets = result.some(r => r.tablename === 'application_packets');
  console.log("  application_packets:", hasPackets ? "EXISTS" : "MISSING");
  
  const funcResult = await sql("SELECT proname FROM pg_proc WHERE proname IN ('set_updated_at', 'get_funnel_counts') ORDER BY proname;");
  console.log("  Functions:", funcResult.map(r => r.proname).join(", ") || "NONE");
  
  const colResult = await sql("SELECT column_name FROM information_schema.columns WHERE table_name = 'profiles' AND column_name IN ('password_hash', 'email_verified', 'verification_token', 'reset_token') ORDER BY column_name;");
  console.log("  Auth columns:", colResult.map(r => r.column_name).join(", ") || "NONE");
}

fix().catch(e => { console.error(e); process.exit(1); });
