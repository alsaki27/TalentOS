// One-off script: migrate ai_task_category_config (v1) -> ai_automations + ai_automation_routes (v2).
// Run once manually after deploying the v2 migration:
//   node scripts/migrate-ai-routing-v1-to-v2.mjs
//
// Maps old 5-category buckets to new 14 automations:
//   parsing_extraction -> resume_parsing, candidate_markitdown, jd_analysis, job_categorization,
//                         keyword_extraction, evidence_mapping, target_jobs_matching
//   resume_studio      -> base_resume_studio, application_tailoring, resume_suggestions
//   content_generation -> cover_letter_gen, recruiter_message_gen, ai_digest
//   chat_assistant     -> chat_assistant
//   default            -> (no mapping — fallback chain, not specific automations)

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "http://localhost:54321";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const DB_CONNECTION = process.env.DATABASE_URL || "";

const CATEGORY_TO_AUTOMATIONS: Record<string, string[]> = {
  parsing_extraction: [
    "resume_parsing",
    "candidate_markitdown",
    "jd_analysis",
    "job_categorization",
    "keyword_extraction",
    "evidence_mapping",
    "target_jobs_matching",
  ],
  resume_studio: [
    "base_resume_studio",
    "application_tailoring",
    "resume_suggestions",
  ],
  content_generation: [
    "cover_letter_gen",
    "recruiter_message_gen",
    "ai_digest",
  ],
  chat_assistant: ["chat_assistant"],
};

async function main() {
  console.log("Migrating ai_task_category_config v1 -> v2...\n");

  let rows: { category: string; provider: string | null; ai_key_id: string | null }[] = [];

  if (DB_CONNECTION) {
    // Neon direct connection
    const { sql } = await import("@neondatabase/serverless");
    const db = sql(DB_CONNECTION);
    rows = await db`SELECT category, provider, ai_key_id FROM ai_task_category_config`;
  } else if (SUPABASE_SERVICE_ROLE_KEY) {
    // Supabase fallback
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await supabase
      .from("ai_task_category_config")
      .select("category, provider, ai_key_id");
    if (error) throw error;
    rows = data ?? [];
  } else {
    throw new Error("Set DATABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  if (rows.length === 0) {
    console.log("No v1 category config rows found. Nothing to migrate.");
    return;
  }

  console.log(`Found ${rows.length} v1 category config rows:`);
  for (const r of rows) {
    console.log(`  ${r.category}: provider=${r.provider ?? "none"}, ai_key_id=${r.ai_key_id ?? "none"}`);

    const automations = CATEGORY_TO_AUTOMATIONS[r.category];
    if (!automations) {
      console.log(`    → No mapping for category '${r.category}', skipping.`);
      continue;
    }

    if (!r.provider && !r.ai_key_id) {
      console.log(`    → No override set, skipping.`);
      continue;
    }

    for (const autoId of automations) {
      if (DB_CONNECTION) {
        const { sql } = await import("@neondatabase/serverless");
        const db = sql(DB_CONNECTION);
        // Check if route already exists for this automation
        const existing = await db`
          SELECT id FROM ai_automation_routes
          WHERE automation_id = ${autoId} AND rank = 1
        `;
        if (existing.length > 0) {
          console.log(`    → Route already exists for ${autoId}, skipping.`);
          continue;
        }
        await db`
          INSERT INTO ai_automation_routes (automation_id, ai_key_id, provider, rank, is_enabled)
          VALUES (${autoId}, ${r.ai_key_id}, ${r.provider}, 1, true)
        `;
        console.log(`    → Created rank=1 route for ${autoId}`);
      } else {
        const { data: existing } = await supabase
          .from("ai_automation_routes")
          .select("id")
          .eq("automation_id", autoId)
          .eq("rank", 1)
          .maybeSingle();
        if (existing) {
          console.log(`    → Route already exists for ${autoId}, skipping.`);
          continue;
        }
        await supabase.from("ai_automation_routes").insert({
          automation_id: autoId,
          ai_key_id: r.ai_key_id,
          provider: r.provider,
          rank: 1,
          is_enabled: true,
        });
        console.log(`    → Created rank=1 route for ${autoId}`);
      }
    }
  }

  console.log("\nMigration complete. Keep ai_task_category_config as rollback path.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
