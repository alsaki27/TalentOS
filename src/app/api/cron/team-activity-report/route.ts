import { NextRequest, NextResponse } from "next/server";
import { isGraphMailConfigured, sendGraphMail } from "@/lib/msGraphMail";
import {
  getTeamActivityReportRecipients,
  getTeamActivityReportWindow,
  renderTeamActivityEmail,
  summarizeTeamActivity,
  type TeamActivityCounts,
  type TeamActivityMember,
  type TeamActivityPeriod,
} from "@/lib/teamActivityEmailReport";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

type ProfileRow = {
  user_id: string;
  display_name: string;
  email: string | null;
  role: string;
  is_active: boolean;
};

type EventAggregateRow = {
  actor_user_id: string;
  display_name: string;
  email: string | null;
  role: string;
  is_active: boolean;
  jobs_added: number;
  duplicate_captures: number;
  candidates_logged: number;
  applications_reviewed: number;
  applications_applied: number;
};

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

function toCounts(row?: Partial<TeamActivityCounts>): TeamActivityCounts {
  return {
    jobs_added: Number(row?.jobs_added ?? 0),
    duplicate_captures: Number(row?.duplicate_captures ?? 0),
    candidates_logged: Number(row?.candidates_logged ?? 0),
    applications_reviewed: Number(row?.applications_reviewed ?? 0),
    applications_applied: Number(row?.applications_applied ?? 0),
  };
}

async function loadMembers(startAt: Date, endAt: Date): Promise<TeamActivityMember[]> {
  const [profiles, aggregates] = await Promise.all([
    query<ProfileRow>(
      `SELECT user_id::text AS user_id, display_name, email, role, is_active
         FROM profiles
        ORDER BY is_active DESC, display_name, email`,
    ),
    query<EventAggregateRow>(
      `SELECT COALESCE(e.actor_user_id::text,
                       'deleted-member:' || COALESCE(NULLIF(to_jsonb(e)->>'actor_display_name', ''), 'Unknown')) AS actor_user_id,
              COALESCE(NULLIF(to_jsonb(e)->>'actor_display_name', ''), p.display_name, 'Deleted member') AS display_name,
              COALESCE(NULLIF(to_jsonb(e)->>'actor_email', ''), p.email) AS email,
              COALESCE(p.role, 'deleted') AS role,
              COALESCE(p.is_active, false) AS is_active,
              COUNT(*) FILTER (WHERE e.event_type = 'job_added')::int AS jobs_added,
              COUNT(*) FILTER (WHERE e.event_type = 'job_duplicate')::int AS duplicate_captures,
              COUNT(*) FILTER (WHERE e.event_type = 'candidate_logged')::int AS candidates_logged,
              COUNT(*) FILTER (WHERE e.event_type = 'application_reviewed')::int AS applications_reviewed,
              COUNT(*) FILTER (WHERE e.event_type = 'application_applied')::int AS applications_applied
         FROM extension_activity_events e
         LEFT JOIN profiles p ON p.user_id = e.actor_user_id
        WHERE e.occurred_at >= $1::timestamptz
          AND e.occurred_at <= $2::timestamptz
          AND e.event_type <> 'resume_edited'
        GROUP BY COALESCE(e.actor_user_id::text,
                          'deleted-member:' || COALESCE(NULLIF(to_jsonb(e)->>'actor_display_name', ''), 'Unknown')),
                 COALESCE(NULLIF(to_jsonb(e)->>'actor_display_name', ''), p.display_name, 'Deleted member'),
                 COALESCE(NULLIF(to_jsonb(e)->>'actor_email', ''), p.email),
                 COALESCE(p.role, 'deleted'), COALESCE(p.is_active, false)
        ORDER BY display_name, email`,
      [startAt.toISOString(), endAt.toISOString()],
    ),
  ]);

  const members = new Map<string, TeamActivityMember>();
  for (const profile of profiles) {
    members.set(profile.user_id, {
      actor_user_id: profile.user_id,
      display_name: profile.display_name || profile.email || "Team member",
      email: profile.email,
      role: profile.role,
      is_active: profile.is_active,
      ...toCounts(),
    });
  }
  for (const aggregate of aggregates) {
    const existing = members.get(aggregate.actor_user_id);
    if (existing) {
      Object.assign(existing, toCounts(aggregate));
      continue;
    }
    members.set(aggregate.actor_user_id, {
      actor_user_id: aggregate.actor_user_id,
      display_name: aggregate.display_name || "Deleted member",
      email: aggregate.email,
      role: aggregate.role,
      is_active: aggregate.is_active,
      ...toCounts(aggregate),
    });
  }
  return Array.from(members.values());
}

async function sendReportEmail(to: string, subject: string, html: string) {
  if (isGraphMailConfigured()) {
    return sendGraphMail({ to, subject, html });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    return { success: false, error: "No configured Skarion email sender is available." };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (response.ok) return { success: true };
    return { success: false, error: `Configured email provider rejected the send (${response.status}).` };
  } catch {
    return { success: false, error: "Could not reach the configured email provider." };
  }
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const periodParam = request.nextUrl.searchParams.get("period");
  if (periodParam !== "daily" && periodParam !== "weekly") {
    return NextResponse.json({ error: "Choose period=daily or period=weekly." }, { status: 400 });
  }
  const period = periodParam as TeamActivityPeriod;
  const recipients = getTeamActivityReportRecipients();
  if (recipients.length === 0) {
    return NextResponse.json({ error: "Set TEAM_ACTIVITY_REPORT_RECIPIENTS before sending reports." }, { status: 503 });
  }
  if (!isGraphMailConfigured() && !(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)) {
    return NextResponse.json({ error: "Configure the existing Skarion Graph or Resend sender before sending reports." }, { status: 503 });
  }

  try {
    const window = getTeamActivityReportWindow(period);
    const members = await loadMembers(window.startAt, window.endAt);
    const baseUrl = (process.env.TALENTOS_BASE_URL || "https://talent.skarion.com").replace(/\/$/, "");
    const html = renderTeamActivityEmail({
      period,
      window,
      members,
      reportUrl: `${baseUrl}/admin/extension-reports`,
    });
    const subject = `Skarion | ${period === "daily" ? "Daily" : "Weekly"} Team Activity Report | ${window.subjectDate}`;
    const results: Array<{ success: boolean; error?: string }> = [];
    for (const recipient of recipients) {
      results.push(await sendReportEmail(recipient, subject, html));
    }

    const sent = results.filter((result) => result.success).length;
    const failed = results.length - sent;
    if (failed > 0) {
      console.error(`[team-activity-report] ${failed} of ${results.length} message(s) failed for period=${period}`);
      return NextResponse.json({ error: "One or more report emails could not be sent.", sent, failed }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      period,
      range: { startAt: window.startAt.toISOString(), endAt: window.endAt.toISOString(), timezone: "America/New_York" },
      recipientCount: recipients.length,
      teamMemberCount: members.length,
      totals: summarizeTeamActivity(members),
    });
  } catch (error) {
    console.error("[team-activity-report] Failed to generate or send report", error);
    return NextResponse.json({ error: "Could not generate or send the team activity report." }, { status: 500 });
  }
}
