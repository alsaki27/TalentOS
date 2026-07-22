import { Client } from "@neondatabase/serverless";
import fs from "fs";

// Read env variables
const envFile = fs.readFileSync(".env.local", "utf8");
const dbUrlMatch = envFile.match(/DATABASE_URL=([^\r\n]+)/);
const DB_URL = process.env.DATABASE_URL || (dbUrlMatch ? dbUrlMatch[1] : null);
const secretMatch = envFile.match(/AI_KEYS_ENCRYPTION_SECRET=([^\r\n]+)/);
process.env.AI_KEYS_ENCRYPTION_SECRET = process.env.AI_KEYS_ENCRYPTION_SECRET || (secretMatch ? secretMatch[1] : null);

import { encryptSecret } from "../src/server/security/secretCrypto.ts";

async function logKeys() {
  const c = new Client(DB_URL);
  await c.connect();
  const res = await c.query("SELECT id, provider, label, is_protected, is_enabled FROM ai_api_keys");
  console.log(res.rows);
  await c.end();
}
logKeys();
