// Neon serverless driver for Cloudflare Workers
// Updated for @neondatabase/serverless v1.x API
// Uses lazy initialization + robust error handling

import { neon, NeonQueryFunction } from "@neondatabase/serverless";

let _sql: NeonQueryFunction<false, false> | null = null;

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL;
  if (!url) {
    const err = new Error(
      "DATABASE_URL or NEON_DATABASE_URL is not configured. Set it in your environment or Cloudflare secrets."
    );
    console.error("[DB] FATAL: Missing DATABASE_URL");
    throw err;
  }
  return url;
}

function getSql(): NeonQueryFunction<false, false> {
  if (!_sql) {
    try {
      const url = getDatabaseUrl();
      console.log(`[DB] Initializing Neon connection (host: ${new URL(url).hostname})`);
      _sql = neon(url, { fetchOptions: { cache: "no-store" } });
    } catch (e: any) {
      console.error("[DB] FATAL: Failed to initialize Neon driver:", e.message);
      throw e;
    }
  }
  return _sql;
}

// Export the raw sql instance for consumers that need it
export { getSql as sql };

// Typed query helper — uses v1.x .query() method for string-based queries
export async function query<T = any>(
  queryText: string,
  params?: unknown[]
): Promise<T[]> {
  try {
    const sql = getSql();
    const result = (await sql.query(queryText, params)) as T[];
    return result;
  } catch (e: any) {
    console.error("[DB] Query failed:", queryText.slice(0, 200));
    console.error("[DB] Error:", e.message || e);
    throw e;
  }
}

// Single row query
export async function queryOne<T = any>(
  queryText: string,
  params?: unknown[]
): Promise<T | null> {
  try {
    const results = await query<T>(queryText, params);
    return results[0] ?? null;
  } catch (e: any) {
    console.error("[DB] queryOne failed:", queryText.slice(0, 200));
    console.error("[DB] Error:", e.message || e);
    throw e;
  }
}

// Insert/Update/Delete (returns affected rows)
export async function execute(
  queryText: string,
  params?: unknown[]
): Promise<{ rowCount: number }> {
  try {
    const sql = getSql();
    const result = (await sql.query(queryText, params)) as any;
    // Handle both array results (SELECT / RETURNING) and command results (DML without RETURNING)
    if (Array.isArray(result)) {
      return { rowCount: result.length };
    }
    if (result && typeof result.rowCount === "number") {
      return { rowCount: result.rowCount };
    }
    return { rowCount: 0 };
  } catch (e: any) {
    console.error("[DB] Execute failed:", queryText.slice(0, 200));
    console.error("[DB] Error:", e.message || e);
    throw e;
  }
}

// Health check — verify connectivity
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
    console.error("[DB] Health check failed:", e.message || e);
    return { ok: false, timestamp: "", error: e.message || String(e) };
  }
}
