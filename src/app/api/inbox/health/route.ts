import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query } from "@/server/db/neon";

export async function GET() {
  const { response } = await requireCurrentUser();
  if (response) return response;
  const [mail, categories, tasks, sync] = await Promise.all([
    query(`SELECT count(*)::int total, count(*) FILTER (WHERE triaged_at IS NOT NULL)::int triaged, count(*) FILTER (WHERE triaged_at IS NULL)::int untriaged, count(*) FILTER (WHERE suppression_reason IS NOT NULL)::int suppressed, count(*) FILTER (WHERE ai_relevant = true)::int relevant FROM email_communications`),
    query(`SELECT coalesce(ai_category,'untriaged') category, count(*)::int count FROM email_communications WHERE sent_at > now() - interval '30 days' GROUP BY 1 ORDER BY count DESC`),
    query(`SELECT type, count(*)::int count FROM action_items WHERE status IN ('open','in_progress') GROUP BY type ORDER BY count DESC`),
    query(`SELECT count(*) FILTER (WHERE status='active')::int active_accounts, count(*) FILTER (WHERE status='error')::int error_accounts, max(last_synced_at) last_synced_at FROM integration_accounts WHERE provider='gmail' AND owner_type='candidate'`),
  ]);
  return NextResponse.json({ mail: mail[0], categories, tasks, sync: sync[0] });
}
