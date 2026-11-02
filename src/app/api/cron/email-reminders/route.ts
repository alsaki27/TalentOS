import { NextRequest, NextResponse } from "next/server";
import { execute, query, queryOne } from "@/server/db/neon";
import { isGraphMailConfigured } from "@/lib/msGraphMail";
import { sendOperationalEmail } from "@/lib/operationalEmail";
import { loadEmailReminderSnapshot } from "@/server/services/emailReminderService";
import { renderEmailReminderDigest } from "@/server/services/emailReminderDigest";

export const dynamic = "force-dynamic";

const authorized = (request: NextRequest) => Boolean(
  process.env.CRON_SECRET && request.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`,
);
const esc = (value: unknown) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const formatTime = (value: Date | string) => new Intl.DateTimeFormat("en-BD", { timeZone: "Asia/Dhaka", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

async function insertDigestNotifications(asOf: Date, snapshot: Awaited<ReturnType<typeof loadEmailReminderSnapshot>>) {
  const profiles = await query<{ user_id: string }>("SELECT user_id FROM profiles WHERE is_active = true");
  const waiting: typeof snapshot.messages = [];
  const overdue: typeof snapshot.messages = [];
  for (const item of snapshot.messages) {
    if (!item.needs_reply || item.replied_at) continue;
    const ageHours = (asOf.getTime() - new Date(item.sent_at).getTime()) / 3_600_000;
    if (ageHours < 12 || ageHours > 24 * 7) continue;
    (ageHours >= 24 ? overdue : waiting).push(item);
  }

  // Retire the earlier one-alert-per-email model. The actual emails remain in
  // Candidate Inbox; the bell now carries one grouped alert for each bucket.
  await execute(
    `DELETE FROM notifications
      WHERE entity_type = 'email_communication'
        AND type IN ('email_reply_waiting', 'email_reply_overdue')`,
  );

  const buckets = [
    { type: "email_reply_waiting", title: "Reply waiting · 12–24 hours", scope: "waiting-12h", messages: waiting },
    { type: "email_reply_overdue", title: "Reply overdue · 24+ hours", scope: "overdue", messages: overdue },
  ];
  let notificationCount = 0;
  for (const bucket of buckets) {
    if (!bucket.messages.length) {
      await execute(
        `UPDATE notifications SET read_at = COALESCE(read_at, now())
          WHERE entity_type = 'email_reminder_digest' AND type = $1 AND read_at IS NULL`,
        [bucket.type],
      );
      continue;
    }
    const candidateCount = new Set(bucket.messages.map((item) => item.candidate_id)).size;
    const messageWord = bucket.messages.length === 1 ? "email needs" : "emails need";
    const candidateWord = candidateCount === 1 ? "candidate" : "candidates";
    const body = `${bucket.messages.length} ${messageWord} a reply from ${candidateCount} ${candidateWord}. Open the list to review them all.`;
    await execute(
      `INSERT INTO notifications (user_id, type, title, body, link, entity_type, entity_id)
       SELECT user_id, $1, $2, $3, $4, 'email_reminder_digest', NULL
         FROM profiles WHERE is_active = true
       ON CONFLICT (user_id, type, COALESCE(entity_type, ''), COALESCE(entity_id::text, ''), title)
       DO UPDATE SET body = EXCLUDED.body, link = EXCLUDED.link, read_at = NULL, created_at = now()`,
      [bucket.type, bucket.title, body, `/inbox/reminders?scope=${bucket.scope}`],
    );
    notificationCount += profiles.length;
  }

  // The older Gmail sync emitted an immediate alert for each important email.
  // Keep those historical records, but don't leave them in the bell.
  await execute(
    `UPDATE notifications SET read_at = COALESCE(read_at, now())
      WHERE type IN ('important_email', 'email_reply_detected') AND read_at IS NULL`,
  );
  return { staffCount: profiles.length, emailCount: waiting.length + overdue.length, notificationCount };
}

async function loadCompleteSnapshot(windowStart: Date, windowEnd: Date) {
  const pageSize = 1000;
  const first = await loadEmailReminderSnapshot({ windowStart, windowEnd, scope: "all", messagePage: 1, messagePageSize: pageSize });
  if (first.messageTotal <= pageSize) return first;
  const messages = [...first.messages];
  const pages = Math.ceil(first.messageTotal / pageSize);
  for (let page = 2; page <= pages; page += 1) {
    const next = await loadEmailReminderSnapshot({ windowStart, windowEnd, scope: "all", messagePage: page, messagePageSize: pageSize });
    messages.push(...next.messages);
  }
  return { ...first, messages };
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const slotKey = request.nextUrl.searchParams.get("slot") || "";
  const windowEnd = new Date(slotKey);
  if (!slotKey || Number.isNaN(windowEnd.getTime()) || !/^\d{4}-\d{2}-\d{2}T(?:08|20):00\+06:00$/.test(slotKey)) {
    return NextResponse.json({ error: "A scheduled 08:00 or 20:00 Bangladesh slot is required." }, { status: 400 });
  }
  const windowStart = new Date(windowEnd.getTime() - 12 * 60 * 60_000);
  const claim = await queryOne<{ slot_key: string }>(
    `INSERT INTO email_reminder_deliveries (slot_key, status) VALUES ($1, 'sending')
     ON CONFLICT (slot_key) DO UPDATE SET status = 'sending', started_at = now(), completed_at = NULL, error_code = NULL
      WHERE email_reminder_deliveries.status = 'failed'
         OR (email_reminder_deliveries.status = 'sending' AND email_reminder_deliveries.started_at < now() - interval '30 minutes')
     RETURNING slot_key`, [slotKey],
  );
  if (!claim) {
    const old = await queryOne<{ status: string }>("SELECT status FROM email_reminder_deliveries WHERE slot_key = $1", [slotKey]);
    return NextResponse.json({ ok: true, alreadySent: old?.status === "sent", inProgress: old?.status === "sending" });
  }

  let notificationResult = { staffCount: 0, emailCount: 0, notificationCount: 0 };
  try {
    await execute("DELETE FROM email_reminder_deliveries WHERE started_at < now() - interval '90 days'");
    await execute(
      `DELETE FROM notifications n USING email_communications ec
        WHERE n.entity_type = 'email_communication' AND n.entity_id = ec.id
          AND n.type IN ('email_reply_waiting', 'email_reply_overdue')
          AND ec.sent_at < now() - interval '7 days'`,
    );
    const snapshot = await loadCompleteSnapshot(windowStart, windowEnd);
    notificationResult = await insertDigestNotifications(windowEnd, snapshot);
    const recipients = await query<{ email: string }>("SELECT email FROM email_reminder_recipients WHERE is_active = true ORDER BY email");
    if (!recipients.length) throw new Error("no_recipients");
    if (!isGraphMailConfigured() && !(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)) throw new Error("sender_unconfigured");

    const baseUrl = (process.env.TALENTOS_BASE_URL || "https://talent.skarion.com").replace(/\/$/, "");
    const html = renderEmailReminderDigest(snapshot, windowStart, windowEnd, baseUrl);
    const subject = `TalentOS | Reply reminders | ${formatTime(windowEnd)}`;
    let sent = 0;
    let failed = 0;
    for (const recipient of recipients) {
      await execute(
        `INSERT INTO email_reminder_delivery_recipients (slot_key, email, status)
         VALUES ($1, $2, 'pending') ON CONFLICT (slot_key, email) DO NOTHING`, [slotKey, recipient.email],
      );
      const row = await queryOne<{ status: string }>("SELECT status FROM email_reminder_delivery_recipients WHERE slot_key = $1 AND email = $2", [slotKey, recipient.email]);
      if (row?.status === "sent") { sent++; continue; }
      await execute("UPDATE email_reminder_delivery_recipients SET status = 'sending', updated_at = now(), error_code = NULL WHERE slot_key = $1 AND email = $2", [slotKey, recipient.email]);
      const result = await sendOperationalEmail(recipient.email, subject, html);
      if (result.success) {
        sent++;
        await execute("UPDATE email_reminder_delivery_recipients SET status = 'sent', updated_at = now() WHERE slot_key = $1 AND email = $2", [slotKey, recipient.email]);
      } else {
        failed++;
        await execute("UPDATE email_reminder_delivery_recipients SET status = 'failed', updated_at = now(), error_code = 'provider_error' WHERE slot_key = $1 AND email = $2", [slotKey, recipient.email]);
      }
    }
    await execute(
      `UPDATE email_reminder_deliveries SET status = $2, completed_at = now(), recipient_count = $3, summary = $4::jsonb, error_code = $5 WHERE slot_key = $1`,
      [slotKey, failed ? "failed" : "sent", sent, JSON.stringify(snapshot.summary), failed ? "recipient_delivery_failed" : null],
    );
    if (failed) return NextResponse.json({ error: "Some reminder emails could not be sent.", sent, failed }, { status: 502 });
    return NextResponse.json({ ok: true, slot: slotKey, sent, summary: snapshot.summary, notifications: notificationResult });
  } catch (error: any) {
    console.error("[email-reminders] Digest run failed", error);
    const failureCode = String(error?.message || "generation_error").slice(0, 80);
    await execute("UPDATE email_reminder_deliveries SET status = 'failed', completed_at = now(), error_code = $2 WHERE slot_key = $1", [slotKey, failureCode]);
    const reason = ["no_recipients", "sender_unconfigured"].includes(failureCode) ? failureCode : "digest_generation_failed";
    return NextResponse.json({ error: "Could not send the email reminder digest.", reason, notifications: notificationResult, emailSent: false }, { status: 500 });
  }
}
