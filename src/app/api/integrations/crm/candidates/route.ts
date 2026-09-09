import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/server/db/neon";

function authorized(req: NextRequest) {
  const secret = process.env.CRM_INTEGRATION_SECRET;
  if (!secret) return false;
  const presented =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    req.headers.get("x-crm-integration-secret")?.trim();
  return Boolean(presented && presented === secret);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized CRM integration request." }, { status: 401 });
  }

  const url = new URL(req.url);
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("pageSize") || "100", 10) || 100));
  const status = (url.searchParams.get("status") || "active").trim().toLowerCase();
  const offset = (page - 1) * pageSize;
  const totalRow = await queryOne<{ total: number }>(
    "SELECT COUNT(*)::int AS total FROM candidates WHERE lower(COALESCE(status, '')) = $1",
    [status]
  );
  const data = await query(
    `SELECT id, candidate_number, name, email, status, pipeline_stage
     FROM candidates
     WHERE lower(COALESCE(status, '')) = $1
     ORDER BY name ASC
     OFFSET $2 LIMIT $3`,
    [status, offset, pageSize]
  );
  return NextResponse.json({ data: data ?? [], total: totalRow?.total ?? 0, page, pageSize, status });
}
