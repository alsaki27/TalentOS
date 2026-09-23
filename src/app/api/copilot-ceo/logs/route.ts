// GET /api/copilot-ceo/logs
// Recent ai_usage_events for the Copilot agent team, for the /copilot-ceo
// management page's Logs tab. Reuses the existing ai_usage_events table —
// no new logging infrastructure needed.

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const limit = Math.min(200, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") || "50", 10) || 50));

  const rows = await query<any>(
    `SELECT id, automation_id, provider, model, outcome, latency_ms,
            input_tokens, output_tokens, estimated_cost_usd, error_message, error_code,
            created_at
     FROM ai_usage_events
     WHERE automation_id LIKE 'copilot%'
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );

  return NextResponse.json({ logs: rows });
}
