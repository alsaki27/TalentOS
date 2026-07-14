// Neon serverless driver for Cloudflare Workers
// Uses lazy initialization + robust error handling.
// The @neondatabase/serverless driver connects via HTTP (not raw TCP), so
// it works in Cloudflare Workers, Next.js Edge, and Node.js without pg-native.
//
// IMPORTANT: do NOT pass Next.js fetch-extensions like { cache: "no-store" }
// in fetchOptions. The Neon driver passes fetchOptions directly to the global
// fetch() call, and non-standard fields cause "TypeError: fetch failed" on
// runtimes where fetch hasn't been patched (e.g. plain Node with undici).

import { neon, NeonQueryFunction } from "@neondatabase/serverless";

let _sql: NeonQueryFunction<false, false> | null = null;

function getDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL;
  if (!raw) {
    const err = new Error(
      "DATABASE_URL or NEON_DATABASE_URL is not configured. Set it in your environment or Cloudflare secrets."
    );
    console.error("[DB] FATAL: Missing DATABASE_URL");
    throw err;
  }
  // The Neon HTTP driver connects over HTTPS via the pooler — it does not
  // open a raw TCP socket.  Strip raw-Postgres-only params that cause the
  // driver to reject the URL:
  const url = new URL(raw);
  url.searchParams.delete("channel_binding");  // TLS channel binding – TCP only
  const sanitized = url.toString();
  if (sanitized !== raw) {
    console.log("[DB] Stripped TCP-only params from DATABASE_URL for HTTP transport");
  }
  return sanitized;
}

function getSql(): NeonQueryFunction<false, false> {
  if (!_sql) {
    try {
      const url = getDatabaseUrl();
      console.log(`[DB] Initializing Neon connection (host: ${new URL(url).hostname})`);
      _sql = neon(url, {
        // arrayMode: false (default) returns rows as objects
        // fullResults: false (default) returns just the rows array from .query()
      });
    } catch (e: any) {
      console.error("[DB] FATAL: Failed to initialize Neon driver:", e.message);
      throw e;
    }
  }
  return _sql;
}

export { getSql as sql };

export async function query<T = any>(
  queryText: string,
  params?: unknown[]
): Promise<T[]> {
  try {
    const sql = getSql();
    const result = (await sql.query(queryText, params)) as T[];
    return result;
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[DB] Query failed:", queryText.slice(0, 200));
    console.error("[DB] Error:", msg);
    throw e;
  }
}

export async function queryOne<T = any>(
  queryText: string,
  params?: unknown[]
): Promise<T | null> {
  try {
    const results = await query<T>(queryText, params);
    return results.length > 0 ? results[0] : null;
  } catch (e: any) {
    console.error("[DB] queryOne failed:", queryText.slice(0, 200));
    throw e;
  }
}

export async function execute(
  queryText: string,
  params?: unknown[]
): Promise<{ rowCount: number }> {
  try {
    const sql = getSql();
    const result = await sql.query(queryText, params, { fullResults: true });
    const rc = typeof result === "object" && result !== null && "rowCount" in result
      ? (result as any).rowCount
      : 0;
    return { rowCount: typeof rc === "number" ? rc : 0 };
  } catch (e: any) {
    console.error("[DB] Execute failed:", queryText.slice(0, 200));
    throw e;
  }
}

export async function testConnection(): Promise<{
  ok: boolean;
  timestamp: string;
  version?: string;
  error?: string;
}> {
  try {
    const sql = getSql();
    const result = await sql.query("SELECT NOW() as time, version() as version");
    return {
      ok: true,
      timestamp: result[0]?.time ?? "unknown",
      version: result[0]?.version ?? "unknown",
    };
  } catch (e: any) {
    return { ok: false, timestamp: "", error: e instanceof Error ? e.message : String(e) };
  }
}
