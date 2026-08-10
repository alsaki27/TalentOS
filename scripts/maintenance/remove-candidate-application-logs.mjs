import { neon } from "@neondatabase/serverless";

const name = (process.argv[2] || "Sheikh Raisa Afreen").trim().toLowerCase();
const databaseUrl = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
if (!databaseUrl) throw new Error("Set DATABASE_URL or NEON_DATABASE_URL before running this one-time cleanup.");

const sql = neon(databaseUrl);
const candidates = await sql`
  SELECT id, name, email
  FROM candidates
  WHERE lower(trim(name)) = ${name}
`;

if (candidates.length !== 1) {
  throw new Error(`Refusing cleanup: expected exactly one candidate named "${name}", found ${candidates.length}.`);
}

const candidate = candidates[0];
const applications = await sql`
  SELECT id, status, ae_stage
  FROM applications
  WHERE candidate_id = ${candidate.id}
  ORDER BY created_at
`;

console.log(JSON.stringify({ candidate, applicationCount: applications.length, applications }, null, 2));
if (process.env.CONFIRM_REMOVE !== "YES") {
  throw new Error("Dry run only. Set CONFIRM_REMOVE=YES to delete these application logs after reviewing the output.");
}

await sql.transaction([
  sql`DELETE FROM application_events WHERE application_id IN (SELECT id FROM applications WHERE candidate_id = ${candidate.id})`,
  sql`DELETE FROM applications WHERE candidate_id = ${candidate.id}`,
]);
console.log(`Removed ${applications.length} application logs for ${candidate.name} (${candidate.id}).`);
