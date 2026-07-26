import { neon } from '@neondatabase/serverless';
import { config } from 'dotenv';
config({ path: '.env' });

async function test() {
  const sql = neon(process.env.DATABASE_URL);
  try {
    const rows = await sql('SELECT id FROM candidates LIMIT 1');
    if (rows.length === 0) {
      console.log("No candidates");
      return;
    }
    const candidateId = rows[0].id;
    console.log("Testing Candidate ID:", candidateId);

    const postRes = await fetch(`http://localhost:3000/api/candidates/${candidateId}/source-of-truth/auto-trigger`, {
      method: "POST"
      // Note: without auth, it will fail unless the route ignores auth or we bypass it
    });
    
    if (!postRes.ok) {
      console.error("Failed with status:", postRes.status);
      console.error(await postRes.text());
    } else {
      console.log("Success!");
      console.log(await postRes.json());
    }
  } catch (e) {
    console.error(e);
  }
}
test();
