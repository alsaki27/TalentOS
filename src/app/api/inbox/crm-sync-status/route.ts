// Read-only diagnostic for the TalentOS -> Skarion CRM recruiter handoff.
// crm_contact_sync_queue (sql/neon_fixes/085_skarion_crm_email_contacts.sql)
// is the durable outbox skarionCrmContactSyncService.ts writes to and drains
// from; this just reports its current state so a stuck or failing sync is
// visible without a database console.
import { NextResponse } from "next/server";
import { ALL_USER_ROLES, requireCurrentUser } from "@/lib/auth";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET() {
  const { response } = await requireCurrentUser(ALL_USER_ROLES);
  if (response) return response;

  const [byStatus, recentFailures, recentSynced, recentPending] = await Promise.all([
    query<{ status: string; count: number }>(
      `SELECT status, count(*)::int count FROM crm_contact_sync_queue GROUP BY status ORDER BY status`
    ),
    query(
      `SELECT q.id, c.name candidate_name, q.contact_email, q.display_name, q.contact_type, q.company,
              q.attempts, q.last_error, q.next_attempt_at, q.last_attempt_at, q.first_discovered_at
         FROM crm_contact_sync_queue q
         JOIN candidates c ON c.id = q.candidate_id
        WHERE q.status = 'failed'
        ORDER BY q.last_attempt_at DESC NULLS LAST LIMIT 20`
    ),
    query(
      `SELECT q.id, c.name candidate_name, q.contact_email, q.display_name, q.contact_type, q.company,
              q.crm_record_url, q.synced_at
         FROM crm_contact_sync_queue q
         JOIN candidates c ON c.id = q.candidate_id
        WHERE q.status = 'synced'
        ORDER BY q.synced_at DESC NULLS LAST LIMIT 20`
    ),
    query(
      `SELECT q.id, c.name candidate_name, q.contact_email, q.display_name, q.contact_type, q.company,
              q.attempts, q.next_attempt_at, q.first_discovered_at
         FROM crm_contact_sync_queue q
         JOIN candidates c ON c.id = q.candidate_id
        WHERE q.status IN ('pending', 'syncing')
        ORDER BY q.first_discovered_at DESC LIMIT 20`
    ),
  ]);

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    byStatus,
    recentFailures,
    recentSynced,
    recentPending,
  });
}
