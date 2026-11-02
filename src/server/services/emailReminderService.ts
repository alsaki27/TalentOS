import { query, queryOne } from "@/server/db/neon";

export const EMAIL_REMINDER_CATEGORIES = [
  "interview_invite", "scheduling", "offer", "recruiter_reply", "application_invite",
] as const;

export type EmailReminderScope = "recent" | "needs-reply" | "waiting-12h" | "overdue" | "replied" | "no-reply-needed" | "all";

export interface EmailReminderMessage {
  id: string;
  candidate_id: string;
  candidate_name: string;
  candidate_email: string | null;
  from_email: string | null;
  subject: string | null;
  snippet: string | null;
  sent_at: string;
  ai_category: string;
  ai_summary: string | null;
  ai_matched_application_id: string | null;
  needs_reply: boolean;
  replied_at: string | null;
  manual_reply: boolean;
  response_due_at: string | null;
  job_id: string | null;
  job_title: string | null;
  company_name: string | null;
  received_in_window: boolean;
  replied_in_window: boolean;
  overdue_24h: boolean;
}

export interface CandidateEmailActivity {
  candidate_id: string;
  candidate_name: string;
  needs_reply: number;
  waiting_12h: number;
  overdue_24h: number;
  replied_12h: number;
}

const INBOUND_CTE = `
  WITH important_inbound AS (
    SELECT ec.id, ec.candidate_id, ec.from_email, ec.subject,
           ec.snippet, ec.sent_at, ec.ai_category, ec.ai_summary,
           ec.ai_matched_application_id, ec.needs_reply, ec.replied_at,
           ec.manual_replied_at,
           reply.detected_replied_at,
           COALESCE(reply.detected_replied_at, ec.replied_at, ec.manual_replied_at) AS effective_replied_at
      FROM email_communications ec
      CROSS JOIN LATERAL (
        SELECT public.email_detected_team_reply_at(ec.id) AS detected_replied_at
      ) reply
     WHERE ec.direction = 'inbound'
       AND ec.candidate_id IS NOT NULL
       AND $1::timestamptz < $2::timestamptz
       AND ec.sent_at >= $2::timestamptz - interval '15 days'
       AND ec.sent_at < $2::timestamptz
       AND ec.suppression_reason IS NULL
       AND ec.ai_relevant IS DISTINCT FROM false
       AND NOT EXISTS (
         SELECT 1 FROM candidates sender_candidate
          WHERE sender_candidate.id = ec.candidate_id
            AND lower(COALESCE(NULLIF(substring(ec.from_email FROM '<([^>]+)>'), ''), btrim(ec.from_email))) = lower(sender_candidate.email)
       )
       AND (
         ec.ai_category = ANY($3::text[])
         OR (ec.ai_category = 'application_confirmation' AND (
           ec.needs_reply = true
           OR ec.replied_at >= ec.sent_at
           OR ec.manual_replied_at IS NOT NULL
           OR reply.detected_replied_at IS NOT NULL
         ))
       )
  )`;

const OPEN_REPLY = `ii.needs_reply = true AND ii.effective_replied_at IS NULL`;
const WAITING_12H = `(${OPEN_REPLY} AND ii.sent_at <= $2::timestamptz - interval '12 hours' AND ii.sent_at > $2::timestamptz - interval '24 hours')`;
const OVERDUE_24H = `(${OPEN_REPLY} AND ii.sent_at < $2::timestamptz - interval '24 hours' AND ii.sent_at >= $2::timestamptz - interval '7 days')`;

const MESSAGE_SELECT = `
  SELECT ii.id, ii.candidate_id, c.name candidate_name, c.email candidate_email,
         ii.from_email, ii.subject, ii.snippet, ii.sent_at,
         ii.ai_category, ii.ai_summary, ii.ai_matched_application_id,
         ii.needs_reply, ii.effective_replied_at AS replied_at,
         (ii.manual_replied_at IS NOT NULL AND ii.detected_replied_at IS NULL) AS manual_reply,
         ii.sent_at + interval '24 hours' AS response_due_at,
         a.job_id, j.title job_title, j.company company_name,
         (ii.sent_at >= $1::timestamptz AND ii.sent_at < $2::timestamptz) received_in_window,
         (ii.effective_replied_at >= $1::timestamptz AND ii.effective_replied_at < $2::timestamptz) replied_in_window,
         (${OVERDUE_24H}) overdue_24h
    FROM important_inbound ii
    JOIN candidates c ON c.id = ii.candidate_id
    LEFT JOIN applications a ON a.id = ii.ai_matched_application_id
    LEFT JOIN jobs j ON j.id = a.job_id`;

function scopePredicate(scope: EmailReminderScope) {
  switch (scope) {
    case "recent": return `(ii.sent_at >= $1::timestamptz AND ii.sent_at < $2::timestamptz)`;
    case "needs-reply": return `(${OPEN_REPLY})`;
    case "waiting-12h": return WAITING_12H;
    case "overdue": return OVERDUE_24H;
    case "replied": return `(ii.effective_replied_at >= $1::timestamptz AND ii.effective_replied_at < $2::timestamptz)`;
    case "no-reply-needed": return `(ii.needs_reply = false AND ii.effective_replied_at IS NULL)`;
    default: return "true";
  }
}

export async function loadEmailReminderSnapshot(options: {
  windowStart: Date;
  windowEnd: Date;
  scope?: EmailReminderScope;
  category?: string;
  candidateId?: string;
  search?: string;
  messagePage?: number;
  messagePageSize?: number;
  candidatePage?: number;
  candidatePageSize?: number;
  focusEmailId?: string;
}) {
  const {
    windowStart, windowEnd, scope = "all", category = "", candidateId = "", search = "",
    messagePage = 1, messagePageSize = 1000, candidatePage = 1, candidatePageSize = 300,
    focusEmailId = "",
  } = options;
  const baseParams: unknown[] = [windowStart.toISOString(), windowEnd.toISOString(), [...EMAIL_REMINDER_CATEGORIES]];
  const page = Math.max(1, messagePage);
  const pageSize = Math.min(1000, Math.max(1, messagePageSize));
  const activityPage = Math.max(1, candidatePage);
  const activityPageSize = Math.min(100, Math.max(1, candidatePageSize));

  const activityFilterParams = [...baseParams];
  const activityPredicates: string[] = [];
  const addActivityFilter = (value: unknown) => {
    activityFilterParams.push(value);
    return `$${activityFilterParams.length}`;
  };
  if (category) activityPredicates.push(`ii.ai_category = ${addActivityFilter(category)}`);
  if (candidateId) activityPredicates.push(`ii.candidate_id = ${addActivityFilter(candidateId)}::uuid`);
  if (search.trim()) {
    const searchParam = addActivityFilter(`%${search.trim()}%`);
    activityPredicates.push(`(c.name ILIKE ${searchParam} OR ii.from_email ILIKE ${searchParam} OR ii.subject ILIKE ${searchParam} OR ii.snippet ILIKE ${searchParam} OR ii.ai_summary ILIKE ${searchParam} OR j.title ILIKE ${searchParam} OR j.company ILIKE ${searchParam})`);
  }
  const activityLimitParam = activityFilterParams.length + 1;
  const activityOffsetParam = activityFilterParams.length + 2;

  const activityCte = `candidate_activity AS (
    SELECT c.id candidate_id, c.name candidate_name,
           COUNT(*) FILTER (WHERE ${OPEN_REPLY})::int needs_reply,
           COUNT(*) FILTER (WHERE ${WAITING_12H})::int waiting_12h,
           COUNT(*) FILTER (WHERE ${OVERDUE_24H})::int overdue_24h,
           COUNT(*) FILTER (WHERE ii.effective_replied_at >= $1::timestamptz AND ii.effective_replied_at < $2::timestamptz)::int replied_12h
      FROM important_inbound ii
      JOIN candidates c ON c.id = ii.candidate_id
      LEFT JOIN applications a ON a.id = ii.ai_matched_application_id
      LEFT JOIN jobs j ON j.id = a.job_id
     ${activityPredicates.length ? `WHERE ${activityPredicates.join(" AND ")}` : ""}
     GROUP BY c.id, c.name
    HAVING COUNT(*) FILTER (WHERE ${OPEN_REPLY}) > 0
        OR COUNT(*) FILTER (WHERE ii.effective_replied_at >= $1::timestamptz AND ii.effective_replied_at < $2::timestamptz) > 0
  )`;

  const [summary, candidateTotal, candidateActivity] = await Promise.all([
    queryOne<any>(
      `${INBOUND_CTE}
       SELECT COUNT(*) FILTER (WHERE ${OPEN_REPLY})::int needs_reply,
              COUNT(*) FILTER (WHERE ${WAITING_12H})::int waiting_12h,
              COUNT(*) FILTER (WHERE ${OVERDUE_24H})::int overdue_24h,
              COUNT(*) FILTER (WHERE ii.effective_replied_at >= $1::timestamptz AND ii.effective_replied_at < $2::timestamptz)::int replied_12h
         FROM important_inbound ii
         JOIN candidates c ON c.id = ii.candidate_id
         LEFT JOIN applications a ON a.id = ii.ai_matched_application_id
         LEFT JOIN jobs j ON j.id = a.job_id
        ${activityPredicates.length ? `WHERE ${activityPredicates.join(" AND ")}` : ""}`,
      activityFilterParams,
    ),
    queryOne<{ total: number }>(
      `${INBOUND_CTE}, ${activityCte}
       SELECT COUNT(*)::int total FROM candidate_activity`,
      activityFilterParams,
    ),
    query<CandidateEmailActivity>(
      `${INBOUND_CTE}, ${activityCte}
       SELECT * FROM candidate_activity
        ORDER BY needs_reply DESC, overdue_24h DESC, waiting_12h DESC, replied_12h DESC, candidate_name ASC
        LIMIT $${activityLimitParam} OFFSET $${activityOffsetParam}`,
      [...activityFilterParams, activityPageSize, (activityPage - 1) * activityPageSize],
    ),
  ]);

  const filterParams = [...baseParams];
  const predicates = [scopePredicate(scope)];
  const addFilter = (value: unknown) => {
    filterParams.push(value);
    return `$${filterParams.length}`;
  };
  if (category) predicates.push(`ii.ai_category = ${addFilter(category)}`);
  if (candidateId) predicates.push(`ii.candidate_id = ${addFilter(candidateId)}::uuid`);
  if (search.trim()) {
    const searchParam = addFilter(`%${search.trim()}%`);
    predicates.push(`(c.name ILIKE ${searchParam} OR ii.from_email ILIKE ${searchParam} OR ii.subject ILIKE ${searchParam} OR ii.snippet ILIKE ${searchParam} OR ii.ai_summary ILIKE ${searchParam} OR j.title ILIKE ${searchParam} OR j.company ILIKE ${searchParam})`);
  }
  const where = predicates.join(" AND ");
  const messageCountParams = [...filterParams];
  const messageLimitParam = filterParams.length + 1;
  const messageOffsetParam = filterParams.length + 2;
  const messageParams = [...filterParams, pageSize, (page - 1) * pageSize];
  const [messageTotal, messages, focusMessage] = await Promise.all([
    queryOne<{ total: number }>(
      `${INBOUND_CTE}
       SELECT COUNT(*)::int total
         FROM important_inbound ii
         JOIN candidates c ON c.id = ii.candidate_id
         LEFT JOIN applications a ON a.id = ii.ai_matched_application_id
         LEFT JOIN jobs j ON j.id = a.job_id
        WHERE ${where}`,
      messageCountParams,
    ),
    query<EmailReminderMessage>(
      `${INBOUND_CTE}
       ${MESSAGE_SELECT}
        WHERE ${where}
        ORDER BY (${OVERDUE_24H}) DESC, (${OPEN_REPLY}) DESC,
                 (ii.effective_replied_at >= $1::timestamptz AND ii.effective_replied_at < $2::timestamptz) DESC,
                 ii.sent_at DESC, ii.id DESC
        LIMIT $${messageLimitParam} OFFSET $${messageOffsetParam}`,
      messageParams,
    ),
    focusEmailId ? queryOne<EmailReminderMessage>(
      `${INBOUND_CTE}
       ${MESSAGE_SELECT}
       WHERE ii.id = $4::uuid
       LIMIT 1`,
      [...baseParams, focusEmailId],
    ) : Promise.resolve(null),
  ]);

  const messageCount = Number(messageTotal?.total || 0);
  const candidateCount = Number(candidateTotal?.total || 0);
  return {
    summary: {
      needs_reply: Number(summary?.needs_reply || 0),
      waiting_12h: Number(summary?.waiting_12h || 0),
      overdue_24h: Number(summary?.overdue_24h || 0),
      replied_12h: Number(summary?.replied_12h || 0),
    },
    candidates: candidateActivity || [],
    candidateActivityTotal: candidateCount,
    candidateActivityPage: activityPage,
    candidateActivityPageSize: activityPageSize,
    messages: messages || [],
    messageTotal: messageCount,
    messagePage: page,
    messagePageSize: pageSize,
    focusMessage: focusMessage || null,
  };
}
