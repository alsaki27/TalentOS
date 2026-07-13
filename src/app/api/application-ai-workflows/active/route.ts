// GET /api/application-ai-workflows/active
// Slim endpoint for polling: returns only {id, status, current_stage, last_error, updated_at, match_score, match_reason}[]
// No joins — the client diffs by id+updated_at and only re-renders changed cards.

import { NextRequest, NextResponse } from "next/server";
import { query as neonQuery } from "@/server/db/neon";

export async function GET(request: NextRequest) {
  try {
    const limit = 50;
    const rows = await neonQuery<any>(
      `SELECT id, status, current_stage, last_error, updated_at, match_score, match_reason,
              application_id, base_resume_id
       FROM application_ai_workflows
       WHERE status IN ('queued', 'running', 'waiting', 'failed')
          OR (status IN ('completed', 'cancelled') AND updated_at >= NOW() - INTERVAL '2 hours')
       ORDER BY updated_at DESC
       LIMIT $1`,
      [limit]
    );
    return NextResponse.json({ workflows: rows });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
