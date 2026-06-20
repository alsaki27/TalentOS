// Neon serverless driver for Cloudflare Workers
import { neon } from "@neondatabase/serverless";

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL or NEON_DATABASE_URL is not configured. Set it in your environment or Cloudflare secrets."
    );
  }
  return url;
}

export const sql = neon(getDatabaseUrl(), { fetchOptions: { cache: "no-store" } });

// Typed query helper
export async function query<T = any>(
  queryText: string,
  params?: (string | number | boolean | null | Date | object)[]
): Promise<T[]> {
  const result = await sql(queryText, params);
  return result as T[];
}

// Single row query
export async function queryOne<T = any>(
  queryText: string,
  params?: (string | number | boolean | null | Date | object)[]
): Promise<T | null> {
  const results = await query<T>(queryText, params);
  return results[0] ?? null;
}

// Insert/Update/Delete (returns affected rows)
export async function execute(
  queryText: string,
  params?: (string | number | boolean | null | Date | object)[]
): Promise<{ rowCount: number }> {
  const result = await sql(queryText, params);
  // The neon driver returns the result rows; for DML we just return a count
  return { rowCount: result.length };
}
