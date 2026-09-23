// GET /api/admin/ai-usage/export?format=csv -> export raw usage events as CSV
// Admin-only. Params: from, to, automationId, aiKeyId

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const url = new URL(req.url);
  const dateFrom = url.searchParams.get("from") || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const dateTo = url.searchParams.get("to") || new Date().toISOString().slice(0, 10);
  const automationFilter = url.searchParams.get("automationId") || "";
  const keyFilter = url.searchParams.get("aiKeyId") || "";
  const format = url.searchParams.get("format") || "csv";

  const conditions: string[] = ["created_at >= $1::date", "created_at <= $2::date + interval '1 day'"];
  const params: (string | number)[] = [dateFrom, dateTo];
  let idx = 3;
  if (automationFilter) {
    conditions.push(`automation_id = $${idx++}`);
    params.push(automationFilter);
  }
  if (keyFilter) {
    conditions.push(`ai_key_id = $${idx++}`);
    params.push(keyFilter);
  }
  const where = conditions.join(" AND ");

  const rows = await query<any>(
    `SELECT
       created_at, automation_id, ai_key_id, provider, model, outcome,
       latency_ms, input_tokens, output_tokens, estimated_cost_usd, error_message
     FROM ai_usage_events
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT 10000`,
    params
  );

  if (format === "csv") {
    const header = "created_at,automation_id,ai_key_id,provider,model,outcome,latency_ms,input_tokens,output_tokens,estimated_cost_usd,error_message";
    const csvRows = rows.map((r: any) =>
      [
        r.created_at,
        r.automation_id,
        r.ai_key_id ?? "",
        r.provider,
        r.model ?? "",
        r.outcome,
        r.latency_ms ?? "",
        r.input_tokens ?? "",
        r.output_tokens ?? "",
        r.estimated_cost_usd ?? "",
        (r.error_message ?? "").replace(/"/g, '""'),
      ].join(",")
    );
    const csv = [header, ...csvRows].join("\n");

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="ai-usage-${dateFrom}-to-${dateTo}.csv"`,
      },
    });
  }

  return NextResponse.json({ rows });
}
