const { Client } = require("pg");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const client = new Client({
  connectionString: databaseUrl
});

async function main() {
  await client.connect();
  const res = await client.query("SELECT candidates.name FROM applications JOIN candidates ON applications.candidate_id = candidates.id WHERE applications.app_number = 10061");
  console.log("Candidate Name:", res.rows[0]?.name || "Not Found");
  await client.end();
}

main().catch(console.error);
