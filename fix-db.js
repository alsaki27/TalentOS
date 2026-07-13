import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL);

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
