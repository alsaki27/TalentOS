// Shared database connection for standalone scripts.
//
// Scripts run under plain Node, not in the Worker, so they connect to Postgres
// directly. Like src/server/db/neon.ts, the driver is chosen from the connection
// string, so a script works against either database with no edit:
//
//   *.neon.tech   -> @neondatabase/serverless (WebSocket Client)
//   anything else -> node-postgres over TCP
//
// Use this instead of importing a driver directly. Roughly thirty scripts still
// construct `new Client()` from @neondatabase/serverless themselves; those only
// ever worked against Neon and will fail against the self-hosted server. Porting
// one is a two-line change: import getDbClient from here and drop the driver
// import.
//
// Usage:
//   import { getDbClient } from "./lib/db.mjs";
//   const db = await getDbClient();
//   const { rows } = await db.query("SELECT 1");
//   await db.end();

import { readFileSync } from "fs";
import { resolve } from "path";

/** DATABASE_URL from the environment, falling back to .env.local. */
export function getDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.NEON_DATABASE_URL) return process.env.NEON_DATABASE_URL;
  try {
    for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf-8").split("\n")) {
      if (line.startsWith("DATABASE_URL=")) return line.split("=").slice(1).join("=").trim();
    }
  } catch {
    /* absent .env.local is fine when the variable is already exported */
  }
  throw new Error("DATABASE_URL not set (checked process.env and .env.local).");
}

export const isNeonUrl = (url) => /\.neon\.tech(?::|\/|$)/i.test(url);

/**
 * A connected client exposing `.query(text, params)` and `.end()`, which is the
 * whole surface the scripts use, so they do not care which driver is underneath.
 *
 * The self-hosted server presents a self-signed certificate, and modern
 * pg-connection-string reads `sslmode=require` as `verify-full` and rejects it.
 * The mode is therefore stripped and TLS configured explicitly: still encrypted,
 * just not CA-verified, which is the strongest the server currently supports.
 */
export async function getDbClient(url = getDatabaseUrl()) {
  if (isNeonUrl(url)) {
    const { Client } = await import("@neondatabase/serverless");
    const client = new Client(url);
    await client.connect();
    return client;
  }

  const { default: pg } = await import("pg");
  const parsed = new URL(url);
  const sslmode = parsed.searchParams.get("sslmode");
  parsed.searchParams.delete("sslmode");
  parsed.searchParams.delete("channel_binding");
  parsed.searchParams.delete("uselibpqcompat");
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(parsed.hostname);

  const client = new pg.Client({
    connectionString: parsed.toString(),
    ssl: local || sslmode === "disable" ? false : { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
}
