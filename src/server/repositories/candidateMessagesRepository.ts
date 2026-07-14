import { queryOne, execute } from "@/server/db/neon";

export interface InboundMessagePayload {
  subject: string | null;
  body: string | null;
  fromAddress: string | null;
  fromName: string | null;
  toAddress: string | null;
  ccAddress: string | null;
  gmailMessageId: string;
  gmailThreadId: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
}

export async function insertInboundMessage(
  candidateId: string,
  payload: InboundMessagePayload
): Promise<string | null> {
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM candidate_messages WHERE candidate_id = $1 AND gmail_message_id = $2 LIMIT 1`,
    [candidateId, payload.gmailMessageId]
  );
  if (existing) return existing.id;

  const result = await queryOne<{ id: string }>(
    `INSERT INTO candidate_messages
       (candidate_id, direction, channel, subject, body, sender_id, sender_name,
        from_address, to_address, cc_address, gmail_message_id, gmail_thread_id,
        in_reply_to, references_header)
     VALUES ($1, 'inbound', 'email', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      candidateId,
      payload.subject,
      payload.body,
      payload.fromAddress,
      payload.fromName,
      payload.fromAddress,
      payload.toAddress,
      payload.ccAddress,
      payload.gmailMessageId,
      payload.gmailThreadId,
      payload.inReplyTo,
      payload.referencesHeader,
    ]
  );

  return result?.id ?? null;
}

export async function getHistoryCursor(integrationAccountId: string): Promise<string | null> {
  const row = await queryOne<{ cursor: string | null }>(
    `SELECT metadata->>'gmail_history_id' AS cursor FROM integration_accounts WHERE id = $1`,
    [integrationAccountId]
  );
  return row?.cursor ?? null;
}

export async function setHistoryCursor(
  integrationAccountId: string,
  historyId: string
): Promise<void> {
  await execute(
    `UPDATE integration_accounts
     SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{gmail_history_id}', to_jsonb($2::text)),
         last_synced_at = now()
     WHERE id = $1`,
    [integrationAccountId, historyId]
  );
}
