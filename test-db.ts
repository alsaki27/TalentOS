import { neon } from '@neondatabase/serverless';

const sql = neon("postgresql://neondb_owner:npg_Gj1bqgAwf0mE@ep-withered-leaf-at0ubn6s-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require");

async function fix() {
  try {
    await sql`ALTER TABLE application_resume_versions DROP CONSTRAINT IF EXISTS app_resume_versions_source_type_check`;
    console.log("Dropped source_type_check constraint");
    await sql`ALTER TABLE application_resume_versions ADD CONSTRAINT app_resume_versions_source_type_check CHECK (source_type IN ('base_resume', 'original_resume', 'blank', 'manual', 'ai_agent'))`;
    console.log("Added new constraint with ai_agent");
  } catch (err) {
    console.error(err);
  }
}
fix();
