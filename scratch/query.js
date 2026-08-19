const { Client } = require("pg");

const client = new Client({
  connectionString: "postgresql://neondb_owner:npg_Gj1bqgAwf0mE@ep-withered-leaf-at0ubn6s-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require"
});

async function main() {
  await client.connect();
  const res = await client.query("SELECT candidates.name FROM applications JOIN candidates ON applications.candidate_id = candidates.id WHERE applications.app_number = 10061");
  console.log("Candidate Name:", res.rows[0]?.name || "Not Found");
  await client.end();
}

main().catch(console.error);
