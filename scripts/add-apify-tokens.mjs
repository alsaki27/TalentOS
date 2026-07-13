// scripts/add-apify-tokens.mjs
// Bulk-insert Apify tokens into the job_agent_apify_tokens pool.
// Usage: node --env-file=.env.local scripts/add-apify-tokens.mjs
// Pastes one token at a time until you enter a blank line.
// Ctrl+C to exit.

import { Client } from "@neondatabase/serverless";
import { readFileSync } from "fs";
import * as readline from "readline";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

async function encryptTokenSafe(token) {
  // Try encryption; fall back to bare: prefix for local dev
  if (process.env.AI_KEYS_ENCRYPTION_SECRET) {
    const { encryptSecret } = await import("../src/server/security/secretCrypto.ts");
    return await encryptSecret(token);
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("AI_KEYS_ENCRYPTION_SECRET must be set in production.");
  }
  console.warn("Storing token without encryption (AI_KEYS_ENCRYPTION_SECRET not set)");
  return "bare:" + token;
}

async function main() {
  const args = process.argv.slice(2);
  const filePath = args[0];

  if (filePath) {
    // Read tokens from file (one per line)
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("#"));
    if (lines.length === 0) { console.log("No tokens found in file."); process.exit(0); }
    console.log(`Found ${lines.length} tokens in file. Inserting...`);

    const client = new Client(url);
    await client.connect();
    let inserted = 0;
    for (let i = 0; i < lines.length; i++) {
      const token = lines[i];
      const encrypted = await encryptTokenSafe(token);
      try {
        await client.query(
          `INSERT INTO job_agent_apify_tokens (label, token_encrypted, priority) VALUES ($1, $2, $3)`,
          [`Token #${i + 1}`, encrypted, i]
        );
        inserted++;
        process.stdout.write(".");
      } catch (e) {
        console.error(`\nError at line ${i + 1}:`, e.message?.slice(0, 100));
      }
    }
    console.log(`\nInserted ${inserted}/${lines.length} tokens.`);
    await client.end();
  } else {
    // Interactive mode
    console.log("Paste Apify tokens one per line (blank line to finish):");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const tokens = [];
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) break;
      tokens.push(trimmed);
    }
    rl.close();
    if (tokens.length === 0) { console.log("No tokens entered."); process.exit(0); }

    const client = new Client(url);
    await client.connect();
    let inserted = 0;
    for (let i = 0; i < tokens.length; i++) {
      const encrypted = await encryptTokenSafe(tokens[i]);
      try {
        await client.query(
          `INSERT INTO job_agent_apify_tokens (label, token_encrypted, priority) VALUES ($1, $2, $3)`,
          [`Token #${i + 1}`, encrypted, i]
        );
        inserted++;
      } catch (e) {
        console.error(`Error:`, e.message?.slice(0, 100));
      }
    }
    console.log(`Inserted ${inserted}/${tokens.length} tokens.`);
    await client.end();
  }
}

main().catch((e) => { console.error("Failed:", e.message); process.exit(1); });