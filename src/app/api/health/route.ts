import { NextRequest, NextResponse } from "next/server";
import { testConnection } from "@/server/db/neon";

export async function GET(req: NextRequest) {
  const checks: Record<string, any> = {};
  const start = Date.now();

  // `testConnection` selects the driver from the active connection string.
  // Keep the health response aligned with that runtime choice so a
  // self-hosted PostgreSQL deployment is not reported as Neon.
  let databaseDriver: string | undefined;
  try {
    const raw = process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL ?? "";
    databaseDriver = /\.neon\.tech(?::|\/|$)/i.test(raw) ? "neon-http" : raw ? "postgres-tcp" : "unconfigured";
  } catch {
    databaseDriver = "unconfigured";
  }

  // Check DB_PROVIDER
  checks.config = {
    db_provider: databaseDriver === "neon-http" ? "neon" : databaseDriver === "postgres-tcp" ? "postgres" : "not set",
    driver: databaseDriver,
    is_neon: databaseDriver === "neon-http",
    has_database_url: !!(process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL),
  };

  // Check DB connectivity
  try {
    const dbResult = await testConnection();
    checks.database = dbResult;
  } catch (e: any) {
    checks.database = { ok: false, error: e.message || String(e) };
  }

  // Check auth config
  checks.auth = {
    has_jwt_secret: !!process.env.JWT_SECRET,
  };

  const duration = Date.now() - start;

  const overall = checks.database?.ok ?? false;
  const status = overall ? 200 : 503;

  return NextResponse.json(
    {
      status: overall ? "ok" : "error",
      duration_ms: duration,
      checks,
    },
    { status }
  );
}
