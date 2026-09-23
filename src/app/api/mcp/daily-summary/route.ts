import { NextResponse } from "next/server";
import { requireCurrentUser, APPLICATION_WORKER_ROLES } from "@/lib/auth";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET() {
  const { response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;
  const rows = await query(`
    SELECT COALESCE(a.ae_applied_by_name, a.ae_reviewed_by_name, 'Unassigned') AS candidate,
           COUNT(*) FILTER (WHERE a.ae_applied_at >= CURRENT_DATE)::int AS applied,
           COUNT(*) FILTER (WHERE a.ae_reviewed_at >= CURRENT_DATE)::int AS reviewed,
           COUNT(*) FILTER (WHERE a.application_stage = 'interview' AND a.application_stage_changed_at >= CURRENT_DATE)::int AS interviews,
           COUNT(*) FILTER (WHERE a.application_stage = 'offer' AND a.application_stage_changed_at >= CURRENT_DATE)::int AS offers
    FROM applications a
    WHERE (a.ae_applied_at >= CURRENT_DATE OR a.ae_reviewed_at >= CURRENT_DATE OR a.application_stage_changed_at >= CURRENT_DATE)
    GROUP BY 1 ORDER BY applied DESC, reviewed DESC`);
  return NextResponse.json({ people: rows });
}
