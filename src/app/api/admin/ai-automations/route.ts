// GET /api/admin/ai-automations -> list all automations with their route chains, grouped by group_label
// Admin-only.

import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET() {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const automations = await query<{
    id: string;
    label: string;
    description: string;
    group_label: string;
    is_active: boolean;
  }>("SELECT id, label, description, group_label, is_active FROM ai_automations ORDER BY group_label, id");

  const automationIds = automations.map((a) => a.id);
  let routesByAutomation: Record<string, any[]> = {};
  if (automationIds.length > 0) {
    const routes = await query<any>(
      `SELECT ar.*, ak.label as key_label, ak.provider as key_provider
       FROM ai_automation_routes ar
       LEFT JOIN ai_api_keys ak ON ar.ai_key_id = ak.id
       WHERE ar.automation_id = ANY($1)
       ORDER BY ar.automation_id, ar.rank`,
      [automationIds]
    );
    for (const r of routes) {
      if (!routesByAutomation[r.automation_id]) routesByAutomation[r.automation_id] = [];
      routesByAutomation[r.automation_id].push(r);
    }
  }

  const grouped: Record<string, any[]> = {};
  for (const auto of automations) {
    const g = auto.group_label;
    if (!grouped[g]) grouped[g] = [];
    grouped[g].push({
      ...auto,
      routes: routesByAutomation[auto.id] ?? [],
    });
  }

  return NextResponse.json({ groups: grouped });
}
