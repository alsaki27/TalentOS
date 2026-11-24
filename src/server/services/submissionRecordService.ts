import { query, queryOne } from "@/server/db/neon";
import { submissionRecordHash, type SubmissionRecord, type SubmissionRecordInput } from "@/lib/submissionRecords";

export const RECORDABLE_CANDIDATE_SQL = "status = 'active' AND COALESCE(pipeline_stage, 'not_started') NOT IN ('paused','placed','dropped')";
export async function listRecordingCandidates(scopedCandidateId: string | null) {
  return query<{ id: string; name: string; pipeline_stage: string | null }>(
    `SELECT id,name,pipeline_stage FROM candidates WHERE ${RECORDABLE_CANDIDATE_SQL}
       AND ($1::uuid IS NULL OR id=$1::uuid) ORDER BY name,id`, [scopedCandidateId]);
}

export async function saveSubmissionRecords(records: SubmissionRecordInput[], actorId: string, keyId: string) {
  const incoming = await Promise.all(records.map(async r => ({ ...r, content_hash: await submissionRecordHash(r) })));
  if (!incoming.length) return { accepted: [] as string[], conflicts: [] as string[] };
  // One SQL statement inserts the batch atomically. Never update or relabel a recorded answer.
  // A second query distinguishes true retries from an event ID reused for different content.
  await query(`INSERT INTO candidate_submission_records
    (event_id,candidate_id,instance_id,instance_name,recorded_by,extension_key_id,
     question,answer,page_url,page_title,field_key,field_type,event_type,recorded_at,content_hash)
    SELECT r.id,r.candidate_id,r.instance_id,r.instance_name,$2::uuid,$3::uuid,
           r.question,r.answer,r.page_url,r.page_title,r.field_key,r.field_type,r.event_type,r.recorded_at,r.content_hash
      FROM jsonb_to_recordset($1::jsonb) AS r(id uuid,candidate_id uuid,instance_id uuid,instance_name text,
        question text,answer text,page_url text,page_title text,field_key text,field_type text,event_type text,
        recorded_at timestamptz,content_hash text)
      JOIN candidates c ON c.id=r.candidate_id
     WHERE c.status='active' AND COALESCE(c.pipeline_stage,'not_started') NOT IN ('paused','placed','dropped')
       AND EXISTS (SELECT 1 FROM extension_api_keys k JOIN profiles p ON p.user_id=k.owner_user_id
                    WHERE k.id=$3::uuid AND k.revoked_at IS NULL AND p.is_active=true
                      AND p.user_id=$2::uuid AND (k.candidate_id IS NULL OR k.candidate_id=r.candidate_id)
                      AND 'extension:submission-records:write'=ANY(k.scopes))
    ON CONFLICT(instance_id,event_id) DO NOTHING`, [JSON.stringify(incoming), actorId, keyId]);
  const existing = await query<{ event_id: string; instance_id: string; content_hash: string; recorded_by: string | null }>(
    `SELECT s.event_id,s.instance_id,s.content_hash,s.recorded_by FROM candidate_submission_records s
     JOIN jsonb_to_recordset($1::jsonb) AS r(id uuid,instance_id uuid)
       ON s.event_id=r.id AND s.instance_id=r.instance_id`, [JSON.stringify(incoming)]);
  const accepted: string[] = [], conflicts: string[] = [];
  for (const record of incoming) {
    const saved = existing.find(r => r.event_id === record.id && r.instance_id === record.instance_id);
    (saved?.content_hash === record.content_hash && saved.recorded_by === actorId ? accepted : conflicts).push(record.id);
  }
  return { accepted, conflicts };
}

export async function listCandidateSubmissionRecords(candidateId: string, search: string, page: number, pageSize: number) {
  const candidate = await queryOne<{ id: string }>("SELECT id FROM candidates WHERE id=$1", [candidateId]);
  if (!candidate) return null;
  const filter = `candidate_id=$1 AND ($2='' OR question ILIKE $3 OR answer ILIKE $3 OR page_title ILIKE $3 OR page_url ILIKE $3)`;
  const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  const [counts, records] = await Promise.all([
    queryOne<{ total: string }>(`SELECT count(*)::text AS total FROM candidate_submission_records WHERE ${filter}`, [candidateId, search, pattern]),
    query<SubmissionRecord>(`SELECT s.id,s.event_id,s.candidate_id,s.instance_id,s.instance_name,s.question,s.answer,
      s.page_url,s.page_title,s.field_key,s.field_type,s.event_type,s.recorded_at,s.received_at,
      p.display_name AS recorded_by_name FROM candidate_submission_records s LEFT JOIN profiles p ON p.user_id=s.recorded_by
      WHERE ${filter} ORDER BY s.received_at DESC,s.id DESC LIMIT $4 OFFSET $5`, [candidateId, search, pattern, pageSize, (page - 1) * pageSize]),
  ]);
  return { records, total: Number(counts?.total || 0), page, pageSize };
}
