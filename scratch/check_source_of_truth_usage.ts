// READ-ONLY. npx tsx --env-file=.env.local scratch/check_source_of_truth_usage.ts
import { query, queryOne } from "../src/server/db/neon";

async function main() {
  const totalCandidates = await queryOne<{ count: string }>("SELECT COUNT(*) as count FROM candidates");
  const totalSoT = await queryOne<{ count: string }>("SELECT COUNT(*) as count FROM candidate_source_of_truth");
  console.log(`Total candidates: ${totalCandidates?.count}`);
  console.log(`Candidates with a candidate_source_of_truth row: ${totalSoT?.count}`);

  const sotWithSkills = await queryOne<{ count: string }>(
    "SELECT COUNT(*) as count FROM candidate_source_of_truth WHERE jsonb_array_length(confirmed_skills) > 0"
  );
  console.log(`...of which have non-empty confirmed_skills: ${sotWithSkills?.count}`);

  const testIstiaque = await queryOne<any>(
    "SELECT * FROM candidate_source_of_truth WHERE candidate_id = $1",
    ["16ad4c1b-ef2f-4535-b7b4-c5115acfe09c"]
  );
  console.log("\nTest Istiaque's candidate_source_of_truth row:", JSON.stringify(testIstiaque, null, 2));

  // Sample a few real (non-test) candidates to see if SoT is populated for actual production use
  const sample = await query<any>(
    `SELECT c.id, c.name, sot.confirmed_skills, sot.last_parsed_at
     FROM candidates c
     LEFT JOIN candidate_source_of_truth sot ON sot.candidate_id = c.id
     WHERE c.name NOT ILIKE '%test%'
     ORDER BY c.created_at DESC LIMIT 10`
  );
  console.log("\nSample of 10 recent real candidates and their SoT status:");
  for (const row of sample) {
    const skillCount = Array.isArray(row.confirmed_skills) ? row.confirmed_skills.length : 0;
    console.log(`  ${row.name}: SoT ${row.last_parsed_at ? "parsed " + row.last_parsed_at : "NEVER PARSED"}, confirmed_skills count=${skillCount}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
