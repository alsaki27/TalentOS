import { query } from "../src/server/db/neon";

async function main() {
  const rows = await query(
    `SELECT v.id, v.title, v.source_type, v.content->>'summary' AS summary, v.created_at
     FROM application_resume_versions v
     WHERE v.candidate_id = '5c563034-edcc-4161-bedb-497f6290517e'
     ORDER BY v.created_at DESC LIMIT 15`
  );
  for (const r of rows as any[]) {
    console.log(String(r.id).slice(0, 8), "|", r.source_type, "|", r.title, "| summary:", JSON.stringify(r.summary)?.slice(0, 120));
  }

  const counts = await query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE content->>'summary' IS NOT NULL AND length(trim(content->>'summary')) > 0)::int AS with_summary
     FROM application_resume_versions
     WHERE source_type = 'ai_agent'`
  );
  console.log("all ai_agent versions:", JSON.stringify(counts));
}

main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
