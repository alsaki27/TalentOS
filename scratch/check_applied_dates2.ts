import { query } from "../src/server/db/neon";

async function main() {
  const counts = await query(
    `SELECT
       COUNT(*) FILTER (WHERE status='applied' AND applied_at IS NULL AND ae_applied_at IS NULL)::int AS applied_missing_both,
       COUNT(*) FILTER (WHERE status='applied' AND applied_at IS NULL AND ae_applied_at IS NOT NULL)::int AS applied_missing_applied_has_ae,
       COUNT(*) FILTER (WHERE status='applied' AND applied_at IS NOT NULL)::int AS applied_with_date,
       COUNT(*) FILTER (WHERE ae_stage='applied' AND status NOT IN ('assigned','stacked','in_progress') )::int AS ae_applied_nonqueue,
       COUNT(*) FILTER (WHERE applied_at::text ~ '^\\d{4}-\\d{2}-\\d{2}$')::int AS date_only_applied,
       COUNT(*) FILTER (WHERE ae_applied_at::text ~ '^\\d{4}-\\d{2}-\\d{2}$')::int AS date_only_ae_applied
     FROM applications`
  );
  console.log(JSON.stringify(counts, null, 2));

  const samples = await query(
    `SELECT id, status, ae_stage, applied_at, ae_applied_at
     FROM applications
     WHERE (status='applied' AND applied_at IS NULL)
        OR applied_at::text ~ '^\\d{4}-\\d{2}-\\d{2}$'
        OR ae_applied_at::text ~ '^\\d{4}-\\d{2}-\\d{2}$'
     ORDER BY created_at DESC LIMIT 20`
  );
  for (const x of samples as any[]) {
    console.log(String(x.id).slice(0, 8), "| status=", x.status, "| ae_stage=", x.ae_stage, "| applied_at=", x.applied_at, "| ae_applied_at=", x.ae_applied_at);
  }
}

main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
