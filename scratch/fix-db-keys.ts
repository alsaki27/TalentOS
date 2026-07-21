import { Client } from "@neondatabase/serverless";
import fs from "fs";

// Read env variables
const envFile = fs.readFileSync(".env.local", "utf8");
const dbUrlMatch = envFile.match(/DATABASE_URL=([^\r\n]+)/);
const DB_URL = process.env.DATABASE_URL || (dbUrlMatch ? dbUrlMatch[1] : null);
const secretMatch = envFile.match(/AI_KEYS_ENCRYPTION_SECRET=([^\r\n]+)/);
const ENCRYPTION_SECRET = process.env.AI_KEYS_ENCRYPTION_SECRET || (secretMatch ? secretMatch[1] : null);
process.env.AI_KEYS_ENCRYPTION_SECRET = ENCRYPTION_SECRET;

import { encryptSecret } from "../src/server/security/secretCrypto.ts";

async function fixEncryption() {
  if (!ENCRYPTION_SECRET) {
    console.log("No encryption secret found in .env.local!");
    return;
  }
  
  const c = new Client(DB_URL);
  await c.connect();
  
  // 1. Fix any plaintext keys (keys not starting with enc:)
  const plaintextKeys = await c.query("SELECT id, encrypted_key FROM ai_api_keys WHERE encrypted_key NOT LIKE 'enc:%'");
  console.log(`Found ${plaintextKeys.rowCount} plaintext keys.`);
  
  for (const row of plaintextKeys.rows) {
      const encrypted = await encryptSecret(row.encrypted_key);
      await c.query("UPDATE ai_api_keys SET encrypted_key = $1 WHERE id = $2", [encrypted, row.id]);
      console.log(`Encrypted plaintext key ${row.id}`);
  }

  // 2. Fix the fake 'enc:PLACEHOLDER' rows that cause IV errors locally
  const fakeRows = await c.query("SELECT id, encrypted_key FROM ai_api_keys WHERE encrypted_key = 'enc:PLACEHOLDER'");
  console.log(`Found ${fakeRows.rowCount} fake enc:PLACEHOLDER keys.`);

  for (const row of fakeRows.rows) {
      // Just encrypt the word "PLACEHOLDER" properly
      const properlyEncrypted = await encryptSecret("PLACEHOLDER");
      await c.query("UPDATE ai_api_keys SET encrypted_key = $1 WHERE id = $2", [properlyEncrypted, row.id]);
      console.log(`Fixed fake enc:PLACEHOLDER key ${row.id}`);
  }

  console.log(`All done! The database should now pass the readiness check and not crash locally.`);
  await c.end();
}
fixEncryption();
