import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query } from "@/server/db/neon";

const EVENT_LABELS = {
  job_added: "Jobs added",
  job_duplicate: "Duplicate captures",
  candidate_logged: "Candidates logged",
  resume_edited: "Tailored resumes edited",
  application_reviewed: "Applications reviewed",
  application_applied: "Applications applied",
} as const;

export async function GET(request: NextRequest) {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const rawDays = Number(request.nextUrl.searchParams.get("days") ?? 30);
  const days = Math.min(30, Math.max(1, Number.isFinite(rawDays) ? Math.trunc(rawDays) : 30));
  const group = request.nextUrl.searchParams.get("group") ?? "day";
  if (!(["day", "week", "month"] as const).includes(group as "day" | "week" | "month")) {
    return NextResponse.json({ error: "group must be day, week, or month" }, { status: 400 });
  }
  const memberId = request.nextUrl.searchParams.get("memberId") || request.nextUrl.searchParams.get("aeId") || null;

  try {
    const [teamMembers, aggregates, events] = await Promise.all([
      query(`SELECT user_id::text AS user_id, display_name, email, role, is_active
               FROM profiles
             UNION ALL
             SELECT 'deleted-member' AS user_id, 'Deleted member' AS display_name,
                    NULL AS email, 'deleted' AS role, false AS is_active
              WHERE EXISTS (
                SELECT 1 FROM extension_activity_events e
                 WHERE e.actor_user_id IS NULL
                   AND to_jsonb(e)->>'actor_display_name' = 'Deleted member'
              )
              ORDER BY is_active DESC, display_name NULLS LAST, email`),
      query(
        `SELECT COALESCE(e.actor_user_id::text, 'deleted-member') AS actor_user_id,
                COALESCE(NULLIF(to_jsonb(e)->>'actor_display_name', ''), p.display_name, 'Deleted member') AS display_name,
                COALESCE(to_jsonb(e)->>'actor_email', p.email) AS email,
                date_trunc($2, e.occurred_at AT TIME ZONE 'Asia/Dhaka')::text AS period,
                COUNT(*) FILTER (WHERE e.event_type = 'job_added')::int AS jobs_added,
                COUNT(*) FILTER (WHERE e.event_type = 'job_duplicate')::int AS duplicate_captures,
                COUNT(*) FILTER (WHERE e.event_type = 'candidate_logged')::int AS candidates_logged,
                COUNT(*) FILTER (WHERE e.event_type = 'resume_edited')::int AS resumes_edited,
                COUNT(*) FILTER (WHERE e.event_type = 'application_reviewed')::int AS applications_reviewed,
                COUNT(*) FILTER (WHERE e.event_type = 'application_applied')::int AS applications_applied
           FROM extension_activity_events e
           LEFT JOIN profiles p ON p.user_id = e.actor_user_id
          WHERE e.occurred_at >= NOW() - ($1::int * INTERVAL '1 day')
            AND (
              $3::text IS NULL
              OR e.actor_user_id::text = $3::text
              OR ($3::text = 'deleted-member' AND e.actor_user_id IS NULL AND to_jsonb(e)->>'actor_display_name' = 'Deleted member')
            )
          GROUP BY COALESCE(e.actor_user_id::text, 'deleted-member'),
                   COALESCE(NULLIF(to_jsonb(e)->>'actor_display_name', ''), p.display_name, 'Deleted member'),
                   COALESCE(to_jsonb(e)->>'actor_email', p.email),
                   date_trunc($2, e.occurred_at AT TIME ZONE 'Asia/Dhaka')
          ORDER BY period DESC, display_name NULLS LAST, email`,
        [days, group, memberId],
      ),
      query(
        `SELECT e.id, e.event_type, e.occurred_at, e.match_score, e.metadata,
                e.actor_user_id, COALESCE(NULLIF(to_jsonb(e)->>'actor_display_name', ''), p.display_name, 'Deleted member') AS actor_name,
                COALESCE(to_jsonb(e)->>'actor_email', p.email) AS actor_email,
                e.job_id, j.title AS job_title, j.company AS job_company, j.location AS job_location,
                e.application_id, e.candidate_id, c.name AS candidate_name,
                e.base_resume_id, br.name AS base_resume_name, e.resume_version_id
           FROM extension_activity_events e
           LEFT JOIN profiles p ON p.user_id = e.actor_user_id
           LEFT JOIN jobs j ON j.id = e.job_id
           LEFT JOIN candidates c ON c.id = e.candidate_id
           LEFT JOIN base_resumes br ON br.id = e.base_resume_id
          WHERE e.occurred_at >= NOW() - ($1::int * INTERVAL '1 day')
            AND (
              $2::text IS NULL
              OR e.actor_user_id::text = $2::text
              OR ($2::text = 'deleted-member' AND e.actor_user_id IS NULL AND to_jsonb(e)->>'actor_display_name' = 'Deleted member')
            )
          ORDER BY e.occurred_at DESC
          LIMIT 500`,
        [days, memberId],
      ),
    ]);

    const totals = Object.fromEntries(Object.keys(EVENT_LABELS).map((key) => [key, 0])) as Record<keyof typeof EVENT_LABELS, number>;
    for (const row of aggregates as Array<Record<string, unknown>>) {
      for (const key of Object.keys(EVENT_LABELS) as Array<keyof typeof EVENT_LABELS>) {
        totals[key] += Number(row[key === "job_added" ? "jobs_added" : key === "job_duplicate" ? "duplicate_captures" : key === "candidate_logged" ? "candidates_logged" : key === "resume_edited" ? "resumes_edited" : key === "application_reviewed" ? "applications_reviewed" : "applications_applied"] ?? 0);
      }
    }
    return NextResponse.json({ days, group, timezone: "Asia/Dhaka", teamMembers, totals, aggregates, events, eventLabels: EVENT_LABELS, eventsCapped: events.length >= 500 });
  } catch (error) {
    console.error("[extension-reports] Failed to load team activity report", error);
    return NextResponse.json({ error: "Could not load extension activity report." }, { status: 500 });
  }
}
