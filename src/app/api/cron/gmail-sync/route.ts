import { NextRequest, NextResponse } from "next/server";
import { query } from "@/server/db/neon";
import { recordJobAttempt, recordJobSuccess, recordJobFailure } from "@/server/services/scheduledJobService";
import { refreshIfNeeded, listMessages, listHistory, getMessage, getProfile } from "@/lib/integrations/gmailClient";
import { insertInboundMessage, getHistoryCursor, setHistoryCursor } from "@/server/repositories/candidateMessagesRepository";
import { createNotification } from "@/lib/notifications";

export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

interface GmailAccountRow {
  id: string;
  candidate_id: string;
  email: string | null;
  access_token: string;
  refresh_token: string | null;
  token_expires_at: string | null;
  scopes: string[] | string | null;
  metadata: Record<string, unknown> | null;
}

const MAX_ACCOUNTS = 20;
const MAX_MESSAGES = 50;

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedMs = Date.now();
  await recordJobAttempt("gmail-sync");

  const accounts = await query<GmailAccountRow>(
    `SELECT id, candidate_id, email, access_token, refresh_token, token_expires_at, scopes, metadata
     FROM integration_accounts
     WHERE provider = 'gmail' AND owner_type = 'candidate' AND status = 'active'
     LIMIT $1`,
    [MAX_ACCOUNTS]
  );

  if (accounts.length === 0) {
    const durationMs = Date.now() - startedMs;
    await recordJobSuccess("gmail-sync", durationMs, "no_active_accounts");
    return NextResponse.json({ ok: true, accounts: 0, messages: 0 });
  }

  let totalInserted = 0;
  const errors: string[] = [];

  for (const account of accounts) {
    try {
      const accessToken = await refreshIfNeeded(account);
      const cursor = await getHistoryCursor(account.id);

      if (!cursor) {
        const msgs = await listMessages(accessToken, "is:inbox", MAX_MESSAGES);
        for (const msg of msgs) {
          try {
            const parsed = await getMessage(accessToken, msg.id, "full");
            if (!parsed) continue;

            await insertInboundMessage(account.candidate_id, {
              subject: parsed.subject,
              body: parsed.bodyPlain,
              fromAddress: parsed.from,
              fromName: parsed.from,
              toAddress: parsed.to,
              ccAddress: parsed.cc,
              gmailMessageId: parsed.id,
              gmailThreadId: parsed.threadId,
              inReplyTo: parsed.inReplyTo,
              referencesHeader: parsed.references,
            });
            totalInserted++;

            await notifyNeedsReply(account.candidate_id);
          } catch {}
        }

        const profile = await getProfile(accessToken);
        if (profile?.historyId) {
          await setHistoryCursor(account.id, profile.historyId);
        }
      } else {
        try {
          const historyItems = await listHistory(accessToken, cursor);
          for (const item of historyItems) {
            if (!item.messagesAdded) continue;
            for (const added of item.messagesAdded) {
              const msg = added.message;
              if (!msg?.id) continue;

              try {
                const parsed = await getMessage(accessToken, msg.id, "full");
                if (!parsed) continue;

                await insertInboundMessage(account.candidate_id, {
                  subject: parsed.subject,
                  body: parsed.bodyPlain,
                  fromAddress: parsed.from,
                  fromName: parsed.from,
                  toAddress: parsed.to,
                  ccAddress: parsed.cc,
                  gmailMessageId: parsed.id,
                  gmailThreadId: parsed.threadId,
                  inReplyTo: parsed.inReplyTo,
                  referencesHeader: parsed.references,
                });
                totalInserted++;

                await notifyNeedsReply(account.candidate_id);
              } catch {}
            }
          }
        } catch (err: any) {
          if (err.message?.includes("historyId") || err.message?.includes("not found")) {
            const msgs = await listMessages(accessToken, "is:inbox", MAX_MESSAGES);
            for (const msg of msgs) {
              try {
                const parsed = await getMessage(accessToken, msg.id, "full");
                if (!parsed) continue;
                await insertInboundMessage(account.candidate_id, {
                  subject: parsed.subject,
                  body: parsed.bodyPlain,
                  fromAddress: parsed.from,
                  fromName: parsed.from,
                  toAddress: parsed.to,
                  ccAddress: parsed.cc,
                  gmailMessageId: parsed.id,
                  gmailThreadId: parsed.threadId,
                  inReplyTo: parsed.inReplyTo,
                  referencesHeader: parsed.references,
                });
                totalInserted++;
              } catch {}
            }
          } else {
            throw err;
          }
        }

        const profile = await getProfile(accessToken);
        if (profile?.historyId) {
          await setHistoryCursor(account.id, profile.historyId);
        }
      }
    } catch (err: any) {
      errors.push(`${account.email ?? account.id}: ${err.message}`);
    }
  }

  const durationMs = Date.now() - startedMs;
  const summary = JSON.stringify({ accounts: accounts.length, inserted: totalInserted });

  if (errors.length > 0) {
    await recordJobFailure("gmail-sync", errors.join("; "), durationMs);
  } else {
    await recordJobSuccess("gmail-sync", durationMs, summary);
  }

  return NextResponse.json({
    ok: errors.length === 0,
    accounts: accounts.length,
    inserted: totalInserted,
    errors: errors.length > 0 ? errors : undefined,
  });
}

async function notifyNeedsReply(candidateId: string) {
  try {
    const appRow = await query(
      `SELECT assigned_to_user_id FROM applications
       WHERE candidate_id = $1 AND status NOT IN ('rejected','withdrawn')
       ORDER BY updated_at DESC LIMIT 1`,
      [candidateId]
    );
    const staffUserId = appRow?.[0]?.assigned_to_user_id ?? null;

    if (staffUserId) {
      const existing = await query(
        `SELECT 1 FROM notifications
         WHERE user_id = $1 AND type = 'email_needs_reply' AND entity_id = $2 AND read_at IS NULL LIMIT 1`,
        [staffUserId, candidateId]
      );
      if (existing.length === 0) {
        await createNotification({
          userId: staffUserId,
          type: "email_needs_reply",
          title: "Candidate needs a reply",
          body: `New email from candidate requires a response.`,
          link: `/communications/inbox?candidateId=${candidateId}`,
          entityType: "candidate",
          entityId: candidateId,
        });
      }
    }
  } catch {}
}
