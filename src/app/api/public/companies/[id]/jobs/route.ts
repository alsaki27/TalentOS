import { NextRequest, NextResponse } from "next/server";
import { pageParams, requirePublicApiScope } from "@/lib/publicApiAuth";
import { query, queryOne } from "@/server/db/neon";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "jobs:read");
  if (response) return response;

  const { page, pageSize, from, to } = pageParams(req, { page: 1, pageSize: 50, maxPageSize: 100 });

  const offset = from;
  const countRow = await queryOne<{ total: number }>(
    `SELECT COUNT(*)::int as total FROM jobs WHERE company_id = $1`,
    [params.id]
  );
  const total = countRow?.total ?? 0;

  const data = await query(
    `SELECT * FROM jobs WHERE company_id = $1 ORDER BY posted_at DESC NULLS LAST OFFSET $2 LIMIT $3`,
    [params.id, offset, pageSize]
  );
  return NextResponse.json({ data: data ?? [], total, page, pageSize });
}
