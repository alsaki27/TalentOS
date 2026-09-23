import { execute, query, queryOne } from "@/server/db/neon";

type ContactType = "recruiter" | "hiring_manager";

function splitName(displayName: string | null) {
  const parts = (displayName || "").replace(/[<>]/g, "").trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || "Unknown", lastName: parts.slice(1).join(" ") || "Contact" };
}

function crmBaseUrl() {
  return (process.env.SKARION_CRM_API_URL || "https://skarion-crm-platform.skarion-talentos.workers.dev").replace(/\/$/, "");
}

export async function queueRecruitingContact(input: { candidateId: string; applicationId?: string | null; emailCommunicationId?: string | null; email: string; displayName?: string | null; contactType: ContactType; company?: string | null; subject?: string | null }) {
  const email = input.email.trim().toLowerCase();
  if (!email || /(?:no[-_.]?reply|mailer[-_.]?daemon)@/i.test(email)) return;
  await execute(`INSERT INTO crm_contact_sync_queue (candidate_id, application_id, email_communication_id, contact_email, display_name, contact_type, company, source_subject)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (candidate_id, contact_email) DO UPDATE SET application_id=COALESCE(EXCLUDED.application_id,crm_contact_sync_queue.application_id), email_communication_id=COALESCE(EXCLUDED.email_communication_id,crm_contact_sync_queue.email_communication_id), display_name=COALESCE(EXCLUDED.display_name,crm_contact_sync_queue.display_name), contact_type=CASE WHEN EXCLUDED.contact_type='hiring_manager' THEN EXCLUDED.contact_type ELSE crm_contact_sync_queue.contact_type END, company=COALESCE(EXCLUDED.company,crm_contact_sync_queue.company), source_subject=COALESCE(EXCLUDED.source_subject,crm_contact_sync_queue.source_subject), status=CASE WHEN crm_contact_sync_queue.status='synced' THEN 'synced' ELSE 'pending' END, next_attempt_at=CASE WHEN crm_contact_sync_queue.status='synced' THEN crm_contact_sync_queue.next_attempt_at ELSE now() END, last_error=NULL`, [input.candidateId, input.applicationId || null, input.emailCommunicationId || null, email, input.displayName || null, input.contactType, input.company || null, input.subject || null]);
}

export async function syncQueuedRecruitingContact(id: string) {
  const row = await queryOne<any>(`SELECT q.*, c.name AS candidate_name FROM crm_contact_sync_queue q JOIN candidates c ON c.id=q.candidate_id WHERE q.id=$1`, [id]);
  if (!row || row.status === "synced" || row.status === "skipped") return;
  const key = process.env.SKARION_CRM_API_KEY;
  if (!key) { await execute("UPDATE crm_contact_sync_queue SET status='failed', last_error=$2, next_attempt_at=now()+interval '30 minutes' WHERE id=$1", [id, "SKARION_CRM_API_KEY is not configured"]); return; }
  await execute("UPDATE crm_contact_sync_queue SET status='syncing', attempts=attempts+1, last_attempt_at=now() WHERE id=$1", [id]);
  const { firstName, lastName } = splitName(row.display_name);
  try {
    const res = await fetch(`${crmBaseUrl()}/extension/leads`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "X-Idempotency-Key": `talentos-email-contact-${row.candidate_id}-${row.contact_email}` }, body: JSON.stringify({ firstName, lastName, email: row.contact_email, companyName: row.company || null, source: "talentos_gmail", status: "new", outreachStatus: "not_contacted", tags: [row.contact_type, "talentos-gmail"], notes: `Discovered from ${row.candidate_name}'s recruiting email${row.source_subject ? `: ${row.source_subject}` : ""}. Candidate ID: ${row.candidate_id}. Application ID: ${row.application_id || "none"}.` }) });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const result: any = await res.json(); const record = result.contact || result.lead;
    if (!record?.id) throw new Error("CRM response did not include a record id");
    await execute("UPDATE crm_contact_sync_queue SET status='synced', crm_record_id=$2, crm_entity_type=$3, crm_record_url=$4, synced_at=now(), last_error=NULL WHERE id=$1", [id, String(record.id), result.entityType || (result.contact ? "contact" : "lead"), result.crmRecordUrl || null]);
  } catch (error: any) {
    const attempts = Number(row.attempts || 0) + 1; const delay = Math.min(1440, 5 * 2 ** Math.min(attempts, 8));
    await execute("UPDATE crm_contact_sync_queue SET status='failed', last_error=$2, next_attempt_at=now()+($3 || ' minutes')::interval WHERE id=$1", [id, String(error?.message || error).slice(0, 1000), String(delay)]);
  }
}

export async function drainRecruitingContactSync(limit = 25) {
  const rows = await queryOne<{ count: string }>("SELECT count(*)::text AS count FROM crm_contact_sync_queue WHERE status IN ('pending','failed') AND next_attempt_at <= now()", []);
  const candidates = Math.min(limit, Number(rows?.count || 0));
  if (!candidates) return { attempted: 0 };
  const due = await query<{ id: string }>("SELECT id FROM crm_contact_sync_queue WHERE status IN ('pending','failed') AND next_attempt_at <= now() ORDER BY next_attempt_at, first_discovered_at LIMIT $1", [candidates]);
  for (const row of due) await syncQueuedRecruitingContact(row.id);
  return { attempted: due.length };
}
