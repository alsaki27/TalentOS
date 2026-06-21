import { NextRequest, NextResponse } from "next/server";
import { testConnection } from "@/server/db/neon";
import { isNeon } from "@/server/db";

export async function GET(req: NextRequest) {
  const checks: Record<string, any> = {};
  const start = Date.now();

  // Check DB_PROVIDER
  checks.config = {
    db_provider: process.env.DB_PROVIDER ?? "not set",
    is_neon: isNeon(),
    has_database_url: !!process.env.DATABASE_URL,
  };

  // Check DB connectivity
  if (isNeon()) {
    try {
      const dbResult = await testConnection();
      checks.database = dbResult;
    } catch (e: any) {
      checks.database = { ok: false, error: e.message || String(e) };
    }
  } else {
    checks.database = { ok: false, error: "DB_PROVIDER is not neon" };
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
