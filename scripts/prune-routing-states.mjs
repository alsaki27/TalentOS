// One-time cleanup: delete every ai_routing_states row except the two the
// user wants kept ("Opencode 9.25 ONLY", "mix 9.23"). See
// D:\Shohan\Skarion\Planning MD Files\AI Resume Pipeline\
// OpenCode_Account_Pooling_And_Routing_State_Cleanup_20260927.md for the
// full reasoning.
//
// Deliberately NOT a sql/neon_fixes/ migration - that pipeline auto-runs
// unattended on every push with no review gate (see sql/neon_fixes/README.md),
// the wrong fit for a destructive one-time delete.
//
// Both FKs to ai_routing_states(id) are ON DELETE SET NULL
// (ai_runtime_config.active_routing_state_id, sql/neon_fixes/079;
// application_ai_workflows.routing_state_id, sql/neon_fixes/088), so this
// delete cannot fail with a foreign-key violation - it silently nulls
// routing_state_id on every historical workflow that ran under a deleted
// state. application_ai_workflows.config_snapshot->>'routingStateId' is a
// separate, non-FK jsonb copy that survives as an orphaned-but-recoverable
// raw UUID string. The live pipeline never reads archived/draft states -
// publishing a state already copies its routes into the separately-live
// ai_automation_routes table - so this is safe for live routing behavior,
// just lossy for per-workflow routing-config traceability.
//
// Usage:
//   node scripts/prune-routing-states.mjs            (dry run, default)
//   node scripts/prune-routing-states.mjs --confirm   (actually deletes)
import pg from "pg";

const { Pool } = pg;

const DATABASE_URL = process.env.TALENTOS_DATABASE_URL || process.env.DATABASE_URL;
const EXPECTED_DB_HOSTS = new Set(
  (process.env.MIX923_EXPECTED_DB_HOSTS || "40.160.139.188,172.18.0.2/32")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);
const KEEP_NAMES = ["Opencode 9.25 ONLY", "mix 9.23"];
const CONFIRM = process.argv.includes("--confirm");

function fail(message) {
  throw new Error(message);
}

async function main() {
  if (!DATABASE_URL) fail("TALENTOS_DATABASE_URL/DATABASE_URL is missing");

  const databaseUrl = new URL(DATABASE_URL);
  databaseUrl.searchParams.delete("sslmode");
  databaseUrl.searchParams.delete("channel_binding");
  const pool = new Pool({
    connectionString: databaseUrl.toString(),
    max: 1,
    ssl: { rejectUnauthorized: false },
  });
  const client = await pool.connect();
  try {
    const dbIdentity = await client.query(
      "select inet_server_addr()::text as server_addr, current_database() as database_name"
    );
    if (
      !EXPECTED_DB_HOSTS.has(dbIdentity.rows[0]?.server_addr) ||
      dbIdentity.rows[0]?.database_name !== "talentos"
    ) {
      fail(
        `Refusing to mutate unexpected database: ${dbIdentity.rows[0]?.server_addr || "unknown"}/${dbIdentity.rows[0]?.database_name || "unknown"}`
      );
    }

    const beforeCount = await client.query("select count(*)::int as n from ai_routing_states");
    console.log(`ai_routing_states row count before: ${beforeCount.rows[0].n}`);

    const candidates = await client.query(
      `select id::text, name, status, updated_at
       from ai_routing_states
       where name <> all($1::text[])
       order by updated_at desc`,
      [KEEP_NAMES]
    );

    if (candidates.rowCount === 0) {
      console.log("Nothing to prune - no rows outside the kept set.");
      return;
    }

    console.log(`\nCandidates for deletion (${candidates.rowCount}), keeping only: ${KEEP_NAMES.join(", ")}`);
    const impact = [];
    for (const row of candidates.rows) {
      const workflowCount = await client.query(
        "select count(*)::int as n from application_ai_workflows where routing_state_id = $1",
        [row.id]
      );
      const n = workflowCount.rows[0].n;
      impact.push({ ...row, workflow_count: n });
      console.log(
        `  [${row.status}] ${row.name}  (updated ${row.updated_at})  -> ${n} workflow row(s) will have routing_state_id set to NULL`
      );
    }

    // Belt-and-suspenders: never delete a kept name, even if it somehow
    // slipped past the WHERE clause above (e.g. a trailing-whitespace name
    // collision).
    const safeIds = impact
      .filter((row) => !KEEP_NAMES.includes(row.name))
      .map((row) => row.id);
    const blocked = impact.filter((row) => KEEP_NAMES.includes(row.name));
    if (blocked.length) {
      console.warn(`Refusing to delete ${blocked.length} row(s) matching a kept name despite the WHERE filter - investigate before proceeding.`);
    }

    if (!CONFIRM) {
      console.log(`\nDry run only - no rows deleted. Re-run with --confirm to delete these ${safeIds.length} state(s).`);
      return;
    }

    const deleted = await client.query(
      "delete from ai_routing_states where id = any($1::uuid[]) returning id::text, name",
      [safeIds]
    );
    console.log(`\nDeleted ${deleted.rowCount} row(s):`);
    for (const row of deleted.rows) console.log(`  ${row.name}`);

    const afterCount = await client.query("select count(*)::int as n from ai_routing_states");
    console.log(`\nai_routing_states row count after: ${afterCount.rows[0].n}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  const detail = [error.detail, error.constraint, error.table].filter(Boolean).join(" | ");
  console.error(`prune-routing-states failed: ${error.message}${detail ? ` (${detail})` : ""}`);
  process.exitCode = 1;
});
