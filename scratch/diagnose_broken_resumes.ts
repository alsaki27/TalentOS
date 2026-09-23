// READ-ONLY. Finds resume versions with a missing name or missing experience
// dates, and correlates them to the model/provider that produced them.
import { query } from "../src/server/db/neon";

async function main() {
  const broken = await query<any>(
    `SELECT id, candidate_id, target_job_id, created_at, source_type,
            COALESCE(content->'header'->>'fullName', '') AS full_name,
            COALESCE(content->'experience'->0->>'startDate', '') AS first_start,
            COALESCE(content->'experience'->0->>'endDate', '') AS first_end,
            jsonb_array_length(COALESCE(content->'certifications','[]'::jsonb)) AS cert_count,
            jsonb_array_length(COALESCE(content->'experience','[]'::jsonb)) AS exp_count
     FROM application_resume_versions
     WHERE source_type = 'ai_agent'
     ORDER BY created_at DESC LIMIT 40`
  );
  const bad = broken.filter((r: any) => !r.full_name || !r.first_start);
  console.log("TOTAL_AI_VERSIONS_SAMPLED:", broken.length);
  console.log("BROKEN (missing name or missing start date):", bad.length);
  console.log(JSON.stringify(bad.slice(0, 10), null, 2));
  console.log("--- HEALTHY SAMPLE ---");
  console.log(JSON.stringify(broken.filter((r: any) => r.full_name && r.first_start).slice(0, 3), null, 2));

  const usage = await query<any>(
    `SELECT automation_id, provider, model, outcome, COUNT(*)::int AS n,
            MIN(created_at) AS first_seen, MAX(created_at) AS last_seen
     FROM ai_usage_events
     WHERE created_at > now() - interval '3 days'
       AND automation_id LIKE 'application_%'
     GROUP BY automation_id, provider, model, outcome
     ORDER BY automation_id, n DESC`
  ).catch((e) => ({ error: e.message }));
  console.log("--- AI USAGE (last 3 days, application agents) ---");
  console.log(JSON.stringify(usage, null, 2));
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
