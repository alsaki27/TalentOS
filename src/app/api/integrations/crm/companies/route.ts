import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/server/db/neon";

function authorized(req: NextRequest) {
  const secret = process.env.CRM_INTEGRATION_SECRET;
  if (!secret) return false;
  const presented = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim()
    || req.headers.get("x-crm-integration-secret")?.trim();
  return Boolean(presented && presented === secret);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized CRM integration request." }, { status: 401 });
  const url = new URL(req.url);
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("pageSize") || "100", 10) || 100));
  const offset = (page - 1) * pageSize;
  const totalRow = await queryOne<{ total: number }>("SELECT COUNT(*)::int AS total FROM companies", []);
  const data = await query(
    `SELECT id, name, website, linkedin_url, logo_url, employees_count, address, slogan, description, industry, source, last_seen_at, created_at, updated_at
     FROM companies ORDER BY last_seen_at DESC NULLS LAST, updated_at DESC OFFSET $1 LIMIT $2`,
    [offset, pageSize]
  );
  return NextResponse.json({ data: data ?? [], total: totalRow?.total ?? 0, page, pageSize });
}
