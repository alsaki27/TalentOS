// Adds "OpenCode C", "OpenCode D", "OpenCode E" as disabled placeholder
// ai_api_keys rows for the shared OpenCode account pool (see
// D:\Shohan\Skarion\Planning MD Files\AI Resume Pipeline\
// OpenCode_Account_Pooling_And_Routing_State_Cleanup_20260927.md).
//
// Deliberately a pure INSERT, unlike scripts/activate-mix923.mjs (which this
// is modeled on for the encryption/DB-host-safety pattern): it does not
// delete any existing OpenCode key, does not touch any routing state or
// ai_automation_routes, and does not live-test the placeholder secret
// against the real OpenCode API - a fake bearer token would predictably
// 401 and force status='invalid', which a confirmed bug in
// PATCH /api/admin/ai/keys/[id] never resets even after a real key is
// added later (it updates last_test_status but not status). Inserting
// directly at status='unknown' avoids ever triggering that bug; 'unknown'
// is never in isKeyHealthBlocked's blocked list, so the standard
// PATCH { apiKey, is_enabled: true } flow works correctly once a real
// key is supplied.
//
// Priorities are discovered at run time (max existing opencode priority +
// 10/20/30), not hard-coded, since the live OpenCode roster is expected to
// change over time (e.g. after mix 9.23's cutover and any keys added since).
import crypto from "node:crypto";
import pg from "pg";

const { Pool } = pg;

const DATABASE_URL = process.env.TALENTOS_DATABASE_URL || process.env.DATABASE_URL;
const ENCRYPTION_SECRET = process.env.AI_KEYS_ENCRYPTION_SECRET;
const EXPECTED_DB_HOSTS = new Set(
  (process.env.MIX923_EXPECTED_DB_HOSTS || "40.160.139.188,172.18.0.2/32")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);
const OPENCODE_BASE_URL = "https://opencode.ai/zen/go/v1";
const NEW_LABELS = ["OpenCode C", "OpenCode D", "OpenCode E"];
const ACTOR = "add-opencode-placeholder-accounts";

function fail(message) {
  throw new Error(message);
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

function encryptSecret(value, secret) {
  const key = crypto.createHash("sha256").update(secret, "utf8").digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const combined = Buffer.concat([iv, ciphertext, cipher.getAuthTag()]);
  return `enc:${combined.toString("base64")}`;
}

async function main() {
  if (!DATABASE_URL) fail("TALENTOS_DATABASE_URL/DATABASE_URL is missing");
  if (!ENCRYPTION_SECRET) fail("AI_KEYS_ENCRYPTION_SECRET is missing");

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

    const existingResult = await client.query(`
      select id::text, label, priority, is_enabled, status, created_at
      from ai_api_keys
      where provider = 'opencode'
      order by priority, created_at
    `);
    console.log(`Current OpenCode accounts (${existingResult.rowCount}):`);
    for (const row of existingResult.rows) {
      console.log(`  ${row.label}  priority=${row.priority}  enabled=${row.is_enabled}  status=${row.status}`);
    }

    const collision = existingResult.rows.find((row) => NEW_LABELS.includes(row.label));
    if (collision) fail(`"${collision.label}" already exists; refusing to insert a duplicate`);

    const maxPriority = existingResult.rows.reduce((max, row) => Math.max(max, row.priority ?? 0), 0);

    await client.query("begin");

    const created = [];
    for (const [index, label] of NEW_LABELS.entries()) {
      const priority = maxPriority + (index + 1) * 10;
      const placeholderSecret = `PENDING_NOT_SET_${label.replace(/\s+/g, "_").toUpperCase()}`;
      const encryptedKey = encryptSecret(placeholderSecret, ENCRYPTION_SECRET);
      const result = await client.query(`
        insert into ai_api_keys (
          provider, label, encrypted_key, key_fingerprint, priority, is_enabled, status,
          base_url, provider_mode, models_endpoint, chat_endpoint,
          auth_header_name, auth_scheme, custom_headers, provider_config, notes
        ) values (
          'opencode', $1, $2, $3, $4, false, 'unknown',
          $5, 'openai_compatible', '/models', '/chat/completions',
          'Authorization', 'Bearer', '{}'::jsonb, '{}'::jsonb, $6
        ) returning id::text, label, priority
      `, [
        label,
        encryptedKey,
        fingerprint(placeholderSecret),
        priority,
        OPENCODE_BASE_URL,
        "Placeholder - pending real API key. Re-enable with PATCH /api/admin/ai/keys/{id} " +
          '{"apiKey": "<real key>", "is_enabled": true}.',
      ]);
      created.push(result.rows[0]);
    }

    await client.query(`
      insert into ai_admin_audit_log (actor_email, action, metadata)
      values ($1, $2, $3::jsonb)
    `, [
      ACTOR,
      "opencode_placeholder_accounts_added",
      JSON.stringify({ created: created.map((row) => ({ id: row.id, label: row.label, priority: row.priority })) }),
    ]);

    await client.query("commit");

    console.log("\nCreated placeholder accounts:");
    for (const row of created) {
      console.log(`  ${row.label}  id=${row.id}  priority=${row.priority}  is_enabled=false  status=unknown`);
    }
    console.log(
      "\nThese are invisible to routing (listEnabledAiKeys filters is_enabled=true) until a real key is " +
        "added via PATCH /api/admin/ai/keys/{id} with { apiKey, is_enabled: true }."
    );
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // Preserve the original failure.
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  const detail = [error.detail, error.constraint, error.table].filter(Boolean).join(" | ");
  console.error(`add-opencode-placeholder-accounts failed: ${error.message}${detail ? ` (${detail})` : ""}`);
  process.exitCode = 1;
});
