import { NextRequest, NextResponse } from "next/server";
import { query } from "@/server/db/neon";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const candidate_id = url.searchParams.get("candidate_id");

    if (!candidate_id) {
      return NextResponse.json({ error: "candidate_id is required" }, { status: 400 });
    }

    const sql = `
      SELECT a.*, j.title as job_title, j.company as job_company
      FROM ats_score_evaluations a
      LEFT JOIN jobs j ON a.job_id = j.id
      WHERE a.candidate_id = $1
      ORDER BY a.created_at DESC
    `;

    const records = await query(sql, [candidate_id]);

    return NextResponse.json({ success: true, data: records });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
