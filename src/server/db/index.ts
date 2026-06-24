// Database abstraction layer.
// Routes to Neon or Supabase based on DB_PROVIDER env var.
// Can be swapped for a different driver without changing consumers.

export { sql, query, queryOne, execute } from "./neon";

// ───────────────────────────────────────────────────────────────
// DB Provider switch
// ───────────────────────────────────────────────────────────────

export const dbProvider = process.env.DB_PROVIDER ?? "supabase";

export function isNeon(): boolean {
  return dbProvider === "neon";
}

export function isSupabase(): boolean {
  return dbProvider === "supabase";
}

export function getDbProvider(): "neon" | "supabase" {
  return isNeon() ? "neon" : "supabase";
}

// ───────────────────────────────────────────────────────────────
// Safe connection check (no import-time crash)
// ───────────────────────────────────────────────────────────────

export function isDatabaseConfigured(): boolean {
  if (isNeon()) {
    return !!(process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL);
  }
  // Supabase is configured via src/lib/supabase.ts (lazy init)
  return true;
}

// ───────────────────────────────────────────────────────────────
// Debug / admin helper: returns active provider for health checks
// ───────────────────────────────────────────────────────────────

export interface DbStatus {
  provider: "neon" | "supabase";
  configured: boolean;
  neonUrlPresent: boolean;
  supabaseUrlPresent: boolean;
}

export function getDbStatus(): DbStatus {
  return {
    provider: getDbProvider(),
    configured: isDatabaseConfigured(),
    neonUrlPresent: !!(process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL),
    supabaseUrlPresent: !!process.env.SUPABASE_URL,
  };
}

// Future: add transaction support if needed
// export { transaction } from "./neon";
