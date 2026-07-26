import { neon } from '@neondatabase/serverless';
import 'dotenv/config';

async function test() {
  const sql = neon(process.env.DATABASE_URL!);
  try {
    const res = await sql("SELECT c.name, br.id as br_id FROM candidates c LEFT JOIN base_resumes br ON c.id = br.candidate_id WHERE c.name = 'Istiaque Sample'");
    console.log(res);
  } catch (e) {
    console.error(e);
  }
}
test();
