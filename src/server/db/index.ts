// Database abstraction layer.

export { sql, query, queryOne, execute } from "./neon";

export const dbProvider = "neon";

export function isNeon(): boolean {
  return true;
}

export function isSupabase(): boolean {
  return false;
}

export function getDbProvider(): "neon" | "supabase" {
  return "neon";
}

export function isDatabaseConfigured(): boolean {
  return !!(process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL);
}

export interface DbStatus {
  provider: "neon" | "supabase";
  configured: boolean;
  neonUrlPresent: boolean;
  supabaseUrlPresent: boolean;
}

export function getDbStatus(): DbStatus {
  return {
    provider: "neon",
    configured: isDatabaseConfigured(),
    neonUrlPresent: !!(process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL),
    supabaseUrlPresent: !!process.env.SUPABASE_URL,
  };
}
