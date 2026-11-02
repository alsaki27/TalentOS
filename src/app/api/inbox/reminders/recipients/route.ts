import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext, requireCurrentUser } from "@/lib/auth";
import { execute, query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getCurrentUserContext();
  if (!context) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const rows = await query<{ email: string }>("SELECT email FROM email_reminder_recipients WHERE is_active = true ORDER BY email");
  return NextResponse.json({ recipients: rows.map((row) => row.email), canEdit: context.profile.role === "admin" });
}

export async function PUT(request: NextRequest) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Provide a recipients array." }, { status: 400 }); }
  if (!Array.isArray(body?.recipients) || body.recipients.length < 1 || body.recipients.length > 20) {
    return NextResponse.json({ error: "Keep between 1 and 20 reminder recipients." }, { status: 400 });
  }
  const recipients: string[] = [...new Set<string>((body.recipients as unknown[]).map((item) => String(item).trim().toLowerCase()))];
  if (recipients.some((email) => email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return NextResponse.json({ error: "One or more email addresses are invalid." }, { status: 400 });
  }
  await execute(
    `WITH requested AS (
       SELECT DISTINCT lower(btrim(req.email)) email FROM unnest($1::text[]) AS req(email)
     ), disabled AS (
       UPDATE email_reminder_recipients SET is_active = false, updated_at = now()
        WHERE is_active = true AND NOT EXISTS (
          SELECT 1 FROM requested WHERE requested.email = email_reminder_recipients.email
        )
     )
     INSERT INTO email_reminder_recipients (email, is_active, added_by_user_id, updated_at)
     SELECT email, true, $2, now() FROM requested
     ON CONFLICT (email) DO UPDATE SET is_active = true, updated_at = now()`,
    [recipients, context.profile.user_id],
  );
  return NextResponse.json({ ok: true, recipients });
}
