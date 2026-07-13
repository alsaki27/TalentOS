import { neon } from '@neondatabase/serverless';

const sql = neon("postgresql://neondb_owner:npg_Gj1bqgAwf0mE@ep-withered-leaf-at0ubn6s-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require");

async function fix() {
  try {
    await sql`ALTER TABLE application_ai_workflows DROP CONSTRAINT IF EXISTS application_ai_workflows_base_resume_id_fkey`;
    console.log("Dropped constraint");
    await sql`ALTER TABLE application_ai_workflows ADD CONSTRAINT application_ai_workflows_base_resume_id_fkey FOREIGN KEY (base_resume_id) REFERENCES base_resumes(id) ON DELETE SET NULL`;
    console.log("Added new constraint");
  } catch (err) {
    console.error(err);
  }
}
fix();
