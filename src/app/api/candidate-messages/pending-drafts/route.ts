import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const candidateId = url.searchParams.get("candidateId");

  let sql = `SELECT cm.*, c.name AS candidate_name
     FROM candidate_messages cm
     JOIN candidates c ON cm.candidate_id = c.id
     WHERE cm.status = 'pending_approval'`;
  const params: unknown[] = [];

  if (candidateId) {
    sql += ` AND cm.candidate_id = $1`;
    params.push(candidateId);
  }

  sql += ` ORDER BY cm.created_at DESC LIMIT 100`;

  const drafts = await query<Record<string, any>>(sql, params);
  return NextResponse.json({ drafts });
}
