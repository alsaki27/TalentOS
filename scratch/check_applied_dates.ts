import { query } from "../src/server/db/neon";

async function main() {
  const rows = await query(
    `SELECT a.id, a.status, a.ae_stage, a.applied_at, a.ae_applied_at, a.created_at
     FROM applications a
     ORDER BY a.created_at DESC
     LIMIT 30`
  );
  for (const x of rows as any[]) {
    console.log(
      String(x.id).slice(0, 8),
      "| status=", x.status,
      "| ae_stage=", x.ae_stage,
      "| applied_at=", x.applied_at,
      "| ae_applied_at=", x.ae_applied_at
    );
  }
  const dateOnly = await query(
    `SELECT COUNT(*)::int AS n FROM applications WHERE applied_at::text ~ '^\\d{4}-\\d{2}-\\d{2}$'`
  );
  console.log("date-only applied_at rows:", (dateOnly as any[])[0]?.n);
}

main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
