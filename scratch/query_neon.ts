import { neon } from "@neondatabase/serverless";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const sql = neon(databaseUrl);
  try {
    const res = await sql`SELECT candidates.name, candidates.candidate_number, candidates.id as c_id, applications.app_number FROM applications JOIN candidates ON applications.candidate_id = candidates.id WHERE candidates.candidate_number = 10061 OR applications.app_number = 10061`;
    console.log("Found:", res);
  } catch (err) {
    console.error(err);
  }
}

main();
