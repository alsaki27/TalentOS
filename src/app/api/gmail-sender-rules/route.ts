import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/auth";
import { execute, query } from "@/server/db/neon";

function allowed(ctx: any) { return ctx?.profile?.role === "admin" || ctx?.profile?.role === "manager"; }

export async function GET() {
  const rows = await query<Record<string, unknown>>(
    "SELECT * FROM gmail_sender_rules ORDER BY updated_at DESC, sender_domain, sender_email",
  );
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const ctx = await getCurrentUserContext();
  if (!allowed(ctx)) return NextResponse.json({ error: "Only managers and admins can manage sender rules." }, { status: 403 });
  const body = await req.json();
  const email = typeof body.sender_email === "string" && body.sender_email.trim() ? body.sender_email.trim().toLowerCase() : null;
  const domain = typeof body.sender_domain === "string" && body.sender_domain.trim() ? body.sender_domain.trim().toLowerCase().replace(/^@/, "") : null;
  if (!email && !domain) return NextResponse.json({ error: "sender_email or sender_domain is required" }, { status: 400 });
  const classes = ["job_board_alert","no_reply","human_recruiter","hiring_manager","employer_system","personal","unknown"];
  if (!classes.includes(body.sender_class)) return NextResponse.json({ error: "Invalid sender_class" }, { status: 400 });
  const row = await query<Record<string, unknown>>(
    `INSERT INTO gmail_sender_rules (sender_email, sender_domain, sender_class, creates_tasks, can_change_stage, notes, created_by_user_id, updated_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
     ON CONFLICT DO NOTHING RETURNING *`,
    [email, domain, body.sender_class, Boolean(body.creates_tasks), Boolean(body.can_change_stage), body.notes || null, ctx!.profile.user_id],
  );
  if (!row[0]) return NextResponse.json({ error: "A rule already exists for this sender." }, { status: 409 });
  return NextResponse.json(row[0], { status: 201 });
}
