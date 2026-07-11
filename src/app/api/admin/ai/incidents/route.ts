import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  try {
    const url = new URL(req.url);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(url.searchParams.get("limit") || "30", 10) || 30)
    );

    const incidents: Array<{
      id: string;
      timestamp: string;
      keyId: string;
      keyLabel: string;
      automationId: string;
      automationLabel: string;
      event: string;
      outcome: string;
      error_message: string | null;
      error_code: string | null;
    }> = [];

    const usageIncidents = await query<any>(
      `SELECT
         e.id, e.created_at, e.ai_key_id::text as ai_key_id,
         e.automation_id, e.outcome, e.error_code, e.error_message,
         ak.label as key_label,
         a.label as automation_label
       FROM ai_usage_events e
       LEFT JOIN ai_api_keys ak ON e.ai_key_id = ak.id
       LEFT JOIN ai_automations a ON e.automation_id = a.id
       WHERE e.outcome IN ('failure', 'timeout')
       ORDER BY e.created_at DESC
       LIMIT $1`,
      [limit]
    );

    for (const row of usageIncidents) {
      incidents.push({
        id: row.id,
        timestamp: row.created_at,
        keyId: row.ai_key_id ?? "",
        keyLabel: row.key_label ?? "Unknown",
        automationId: row.automation_id ?? "",
        automationLabel: row.automation_label ?? "Unknown",
        event:
          row.outcome === "timeout"
            ? "timeout"
            : row.error_code
              ? `failure (${row.error_code})`
              : "failure",
        outcome: row.outcome,
        error_message: row.error_message ?? null,
        error_code: row.error_code ?? null,
      });
    }

    const recentlyFailing = await query<any>(
      `SELECT id::text, label, updated_at, last_error_code, last_error_message
       FROM ai_api_keys
       WHERE status = 'failing'
         AND updated_at >= NOW() - interval '30 days'
       ORDER BY updated_at DESC
       LIMIT $1`,
      [limit]
    );

    for (const row of recentlyFailing) {
      incidents.push({
        id: `key-failing-${row.id}`,
        timestamp: row.updated_at,
        keyId: row.id,
        keyLabel: row.label,
        automationId: "",
        automationLabel: "",
        event: row.last_error_code
          ? `key_failing (${row.last_error_code})`
          : "key_failing",
        outcome: "failure",
        error_message: row.last_error_message ?? null,
        error_code: row.last_error_code ?? null,
      });
    }

    const recentlyDisabled = await query<any>(
      `SELECT id::text, label, updated_at, last_error_code, last_error_message
       FROM ai_api_keys
       WHERE status = 'disabled'
         AND is_enabled = false
         AND updated_at >= NOW() - interval '30 days'
       ORDER BY updated_at DESC
       LIMIT $1`,
      [limit]
    );

    for (const row of recentlyDisabled) {
      incidents.push({
        id: `key-disabled-${row.id}`,
        timestamp: row.updated_at,
        keyId: row.id,
        keyLabel: row.label,
        automationId: "",
        automationLabel: "",
        event: "key_disabled",
        outcome: "failure",
        error_message: row.last_error_message ?? null,
        error_code: row.last_error_code ?? null,
      });
    }

    incidents.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    return NextResponse.json({
      incidents: incidents.slice(0, limit),
    });
  } catch (err: any) {
    console.error("[ai/incidents]", err.message || err);
    return NextResponse.json(
      { error: "Failed to load incidents" },
      { status: 500 }
    );
  }
}
