// Quick database connectivity test
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = neon(url);
sql`SELECT 1 AS ok`
  .then((r) => {
    console.log("Connected:", JSON.stringify(r));
    process.exit(0);
  })
  .catch((e) => {
    console.error("Failed:", e.message);
    process.exit(1);
  });
