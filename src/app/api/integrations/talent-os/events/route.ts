import { NextRequest, NextResponse } from "next/server";
import { DESTRUCTIVE_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { query } from "@/server/db/neon";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser(DESTRUCTIVE_MANAGER_ROLES);
  if (response) return response;

  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "25", 10) || 25));

  let data: any;
  let error: any;

  try {
    data = await query(
      `SELECT * FROM integration_events WHERE source = 'talent_os' ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    error = null;
  } catch (err: any) {
    error = { message: err.message };
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
