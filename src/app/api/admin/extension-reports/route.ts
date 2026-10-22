import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query } from "@/server/db/neon";

const EVENT_LABELS = {
  job_added: "Jobs added",
  job_duplicate: "Duplicate captures",
  candidate_logged: "Candidates logged",
  application_reviewed: "Reviews completed",
  application_applied: "Marked as applied",
} as const;

const REPORT_TIMEZONE = "Asia/Dhaka";
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function validLocalDateTime(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
    && parsed.getUTCHours() === hour
    && parsed.getUTCMinutes() === minute;
}

function dhakaLocalDateTime(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

export async function GET(request: NextRequest) {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const params = request.nextUrl.searchParams;
  const startAtParam = params.get("startAt");
  const endAtParam = params.get("endAt");
  const now = new Date();
  const startAt = startAtParam ?? dhakaLocalDateTime(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const endAt = endAtParam ?? dhakaLocalDateTime(now);
  if (!validLocalDateTime(startAt) || !validLocalDateTime(endAt)) {
    return NextResponse.json({ error: "Choose valid start and end date/time values." }, { status: 400 });
  }
  if (startAt > endAt) {
    return NextResponse.json({ error: "The start date/time must be before the end date/time." }, { status: 400 });
  }

  const memberId = params.get("memberId") || null;
  const candidateId = params.get("candidateId") || null;
  const eventTypeParam = params.get("eventType") || null;
  const eventType = eventTypeParam && Object.hasOwn(EVENT_LABELS, eventTypeParam) ? eventTypeParam : null;
  if (eventTypeParam && !eventType) {
    return NextResponse.json({ error: "Choose a valid action type." }, { status: 400 });
  }
  const rawPage = Number(params.get("page") ?? 1);
  const rawPageSize = Number(params.get("pageSize") ?? DEFAULT_PAGE_SIZE);
  const page = Math.max(1, Number.isFinite(rawPage) ? Math.trunc(rawPage) : 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(10, Number.isFinite(rawPageSize) ? Math.trunc(rawPageSize) : DEFAULT_PAGE_SIZE));
  const filterValues = [startAt, endAt, memberId, candidateId, eventType];
  const filteredWhere = `e.occurred_at >= ($1::timestamp AT TIME ZONE '${REPORT_TIMEZONE}')
            AND e.occurred_at <= ($2::timestamp AT TIME ZONE '${REPORT_TIMEZONE}')
            AND e.event_type <> 'resume_edited'
            AND ($3::text IS NULL OR e.actor_user_id::text = $3::text
              OR ($3::text = 'deleted-member' AND e.actor_user_id IS NULL AND to_jsonb(e)->>'actor_display_name' = 'Deleted member'))
            AND ($4::text IS NULL OR e.candidate_id::text = $4::text)
            AND ($5::text IS NULL OR e.event_type = $5::text)`;
  const eventsSql = `SELECT e.id, e.event_type, e.occurred_at, e.metadata,
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
          WHERE ${filteredWhere}
          ORDER BY e.occurred_at DESC, e.id DESC
          LIMIT $6 OFFSET $7`;

  try {
    const [teamMembers, candidates, teamTotals, activityBreakdown, eventCount, events] = await Promise.all([
      query(`SELECT user_id::text AS user_id, display_name, email, role, is_active
               FROM profiles
             UNION ALL
             SELECT 'deleted-member' AS user_id, 'Deleted member' AS display_name,
                    NULL AS email, 'deleted' AS role, false AS is_active
              WHERE EXISTS (
                SELECT 1 FROM extension_activity_events e
                 WHERE e.actor_user_id IS NULL
                   AND e.event_type <> 'resume_edited'
                   AND to_jsonb(e)->>'actor_display_name' = 'Deleted member'
              )
              ORDER BY is_active DESC, display_name NULLS LAST, email`),
      query(`SELECT c.id::text AS candidate_id, c.name AS candidate_name
               FROM candidates c
              WHERE EXISTS (
                SELECT 1 FROM extension_activity_events e
                 WHERE e.candidate_id = c.id
                   AND e.event_type <> 'resume_edited'
              )
              ORDER BY c.name NULLS LAST`),
      query(
        `SELECT COALESCE(e.actor_user_id::text, 'deleted-member') AS actor_user_id,
                COALESCE(NULLIF(to_jsonb(e)->>'actor_display_name', ''), p.display_name, 'Deleted member') AS display_name,
                COALESCE(to_jsonb(e)->>'actor_email', p.email) AS email,
                COUNT(*) FILTER (WHERE e.event_type = 'job_added')::int AS jobs_added,
                COUNT(*) FILTER (WHERE e.event_type = 'job_duplicate')::int AS duplicate_captures,
                COUNT(*) FILTER (WHERE e.event_type = 'candidate_logged')::int AS candidates_logged,
                COUNT(*) FILTER (WHERE e.event_type = 'application_reviewed')::int AS applications_reviewed,
                COUNT(*) FILTER (WHERE e.event_type = 'application_applied')::int AS applications_applied
           FROM extension_activity_events e
           LEFT JOIN profiles p ON p.user_id = e.actor_user_id
          WHERE ${filteredWhere}
          GROUP BY COALESCE(e.actor_user_id::text, 'deleted-member'),
                   COALESCE(NULLIF(to_jsonb(e)->>'actor_display_name', ''), p.display_name, 'Deleted member'),
                   COALESCE(to_jsonb(e)->>'actor_email', p.email)
          ORDER BY display_name NULLS LAST, email`,
        filterValues,
      ),
      query(
        `SELECT date_trunc('day', e.occurred_at AT TIME ZONE '${REPORT_TIMEZONE}')::date::text AS period,
                COALESCE(e.actor_user_id::text, 'deleted-member') AS actor_user_id,
                COALESCE(NULLIF(to_jsonb(e)->>'actor_display_name', ''), p.display_name, 'Deleted member') AS display_name,
                COALESCE(to_jsonb(e)->>'actor_email', p.email) AS email,
                COUNT(*) FILTER (WHERE e.event_type = 'job_added')::int AS jobs_added,
                COUNT(*) FILTER (WHERE e.event_type = 'job_duplicate')::int AS duplicate_captures,
                COUNT(*) FILTER (WHERE e.event_type = 'candidate_logged')::int AS candidates_logged,
                COUNT(*) FILTER (WHERE e.event_type = 'application_reviewed')::int AS applications_reviewed,
                COUNT(*) FILTER (WHERE e.event_type = 'application_applied')::int AS applications_applied
           FROM extension_activity_events e
           LEFT JOIN profiles p ON p.user_id = e.actor_user_id
          WHERE ${filteredWhere}
          GROUP BY date_trunc('day', e.occurred_at AT TIME ZONE '${REPORT_TIMEZONE}')::date,
                   COALESCE(e.actor_user_id::text, 'deleted-member'),
                   COALESCE(NULLIF(to_jsonb(e)->>'actor_display_name', ''), p.display_name, 'Deleted member'),
                   COALESCE(to_jsonb(e)->>'actor_email', p.email)
          ORDER BY period DESC, display_name NULLS LAST, email`,
        filterValues,
      ),
      query(
        `SELECT COUNT(*)::int AS total
           FROM extension_activity_events e
          WHERE ${filteredWhere}`,
        filterValues,
      ),
      query(
        eventsSql,
        [...filterValues, pageSize, (page - 1) * pageSize],
      ),
    ]);

    const totals = Object.fromEntries(Object.keys(EVENT_LABELS).map((key) => [key, 0])) as Record<keyof typeof EVENT_LABELS, number>;
    for (const row of teamTotals as Array<Record<string, unknown>>) {
      for (const [eventKey, countKey] of Object.entries({
        job_added: "jobs_added",
        job_duplicate: "duplicate_captures",
        candidate_logged: "candidates_logged",
        application_reviewed: "applications_reviewed",
        application_applied: "applications_applied",
      }) as Array<[keyof typeof EVENT_LABELS, string]>) {
        totals[eventKey] += Number(row[countKey] ?? 0);
      }
    }
    const total = Number((eventCount as Array<{ total: number }>)[0]?.total ?? 0);
    const totalPages = Math.ceil(total / pageSize);
    const currentPage = totalPages === 0 ? 1 : Math.min(page, totalPages);
    const pagedEvents = currentPage === page
      ? events
      : await query(
        eventsSql,
        [...filterValues, pageSize, (currentPage - 1) * pageSize],
      );

    return NextResponse.json({
      timezone: REPORT_TIMEZONE,
      range: { startAt, endAt },
      teamMembers,
      candidates,
      totals,
      teamTotals,
      activityBreakdown,
      events: pagedEvents,
      eventLabels: EVENT_LABELS,
      pagination: { page: currentPage, pageSize, total, totalPages },
    });
  } catch (error) {
    console.error("[extension-reports] Failed to load team activity report", error);
    return NextResponse.json({ error: "Could not load extension activity report." }, { status: 500 });
  }
}
