import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon("postgresql://neondb_owner:npg_Gj1bqgAwf0mE@ep-withered-leaf-at0ubn6s-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require");
  try {
    const res = await sql`SELECT candidates.name, candidates.candidate_number, candidates.id as c_id, applications.app_number FROM applications JOIN candidates ON applications.candidate_id = candidates.id WHERE candidates.candidate_number = 10061 OR applications.app_number = 10061`;
    console.log("Found:", res);
  } catch (err) {
    console.error(err);
  }
}

main();
