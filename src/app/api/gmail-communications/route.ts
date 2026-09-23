// src/app/api/gmail-communications/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ALL_USER_ROLES, requireCurrentUser } from "@/lib/auth";
import { query, queryOne } from "@/server/db/neon";
import { CLEARANCE_KEYWORDS, clearanceExclusionSql } from "@/lib/mailClearanceFilter";

export const dynamic = "force-dynamic";

const DIRECTIONS = new Set(["all", "inbox", "sent"]);

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser(ALL_USER_ROLES);
  if (response) return response;

  const url = new URL(req.url);
  const direction = url.searchParams.get("direction") || "inbox";
  const candidateId = (url.searchParams.get("candidateId") || "").trim();
  const category = (url.searchParams.get("category") || "").trim();
  const search = (url.searchParams.get("search") || "").trim();
  const needsReply = url.searchParams.get("needsReply");
  const relevant = url.searchParams.get("relevant");
  const hasOpenTask = url.searchParams.get("hasOpenTask");
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(10, Number.parseInt(url.searchParams.get("pageSize") || "25", 10) || 25));

  if (!DIRECTIONS.has(direction)) return NextResponse.json({ error: "Invalid direction." }, { status: 400 });
  if (candidateId && !isUuid(candidateId)) return NextResponse.json({ error: "Invalid candidateId." }, { status: 400 });
  if (needsReply && !["true", "false"].includes(needsReply)) return NextResponse.json({ error: "Invalid needsReply filter." }, { status: 400 });
  if (relevant && !["true", "false"].includes(relevant)) return NextResponse.json({ error: "Invalid relevant filter." }, { status: 400 });
  if (hasOpenTask && !["true", "false"].includes(hasOpenTask)) return NextResponse.json({ error: "Invalid hasOpenTask filter." }, { status: 400 });

  // ── Main query params (count + threads) ────────────────────────────────────
  // If `category` is set, the per-category predicate is appended only to this
  // set so the thread list is filtered while categoryCounts still covers all.
  const mainParams: unknown[] = [];
  const mainPredicates: string[] = ["1=1"];
  const addMain = (value: unknown) => {
    mainParams.push(value);
    return `$${mainParams.length}`;
  };

  // ── Category-counts query params ────────────────────────────────────────────
  // Independent params array — mirrors mainPredicates without the per-category
  // filter so we get counts for every category bucket in one parallel query.
  const catParams: unknown[] = [];
  const catPredicates: string[] = ["1=1"];
  const addCat = (value: unknown) => {
    catParams.push(value);
    return `$${catParams.length}`;
  };

  // Shared filter builder — called once per query set with its own add() closure
  // so $N indices are always correct and never bleed between query sets.
  const applySharedPredicates = (bucket: string[], add: (v: unknown) => string) => {
    if (direction === "inbox") {
      bucket.push(`ec.direction = 'inbound'`);
      bucket.push(`NOT EXISTS (
      SELECT 1
        FROM action_items ai3
        JOIN applications approval_app3 ON approval_app3.id = ai3.application_id
       WHERE ai3.email_communication_id = ec.id
         AND ai3.type = 'status_change_approval'
         AND ai3.status IN ('open', 'in_progress')
         AND ai3.proposed_status IS NOT NULL
         AND approval_app3.status IS DISTINCT FROM ai3.proposed_status
    )`);
    }
    if (direction === "sent") bucket.push(`ec.direction = 'outbound'`);
    if (candidateId) bucket.push(`ec.candidate_id = ${add(candidateId)}`);
    if (needsReply) bucket.push(`ec.needs_reply = ${add(needsReply === "true")}`);
    if (relevant) {
      if (relevant === "true") {
        // suppression_reason catches deterministic noise (job-board digests,
        // bulk marketing, no-reply senders) *before* AI triage runs. It does
        // NOT reflect the AI's own relevance judgment - a message can clear
        // that pre-filter and still be triaged ai_relevant=false (genuinely
        // not job-related). Both must hold for "only job-related mail".
        bucket.push(`ec.suppression_reason IS NULL AND ec.ai_relevant IS DISTINCT FROM false`);
      } else {
        bucket.push(`(ec.suppression_reason IS NOT NULL OR ec.ai_relevant = false)`);
      }
    }
    bucket.push(clearanceExclusionSql(add(CLEARANCE_KEYWORDS)));
    if (hasOpenTask) {
      const existsSql = `EXISTS (
      SELECT 1
        FROM action_items ai2
        LEFT JOIN applications approval_app2 ON approval_app2.id = ai2.application_id
       WHERE ai2.email_communication_id = ec.id
         AND ai2.status IN ('open', 'in_progress')
         AND (ai2.type <> 'status_change_approval'
               OR (ai2.application_id IS NOT NULL AND ai2.proposed_status IS NOT NULL
                   AND approval_app2.status IS DISTINCT FROM ai2.proposed_status))
    )`;
      bucket.push(hasOpenTask === "true" ? existsSql : `NOT ${existsSql}`);
    }
    if (search) {
      const term = `%${search}%`;
      const p = add(term);
      bucket.push(`(ec.subject ILIKE ${p} OR ec.from_email ILIKE ${p} OR ec.snippet ILIKE ${p} OR ec.body_text ILIKE ${p} OR c.name ILIKE ${p} OR ec.gmail_thread_id ILIKE ${p})`);
    }
  };

  // Apply shared filters to both param sets independently.
  applySharedPredicates(mainPredicates, addMain);
  applySharedPredicates(catPredicates, addCat);

  // Per-category filter goes only into the main query's predicates + params.
  if (category) mainPredicates.push(`ec.ai_category = ${addMain(category)}`);

  const whereSql = mainPredicates.join(" AND ");
  const categoryWhereSql = catPredicates.join(" AND ");

  const [count, categoryCounts] = await Promise.all([
    queryOne<{ total: string }>(
      `SELECT COUNT(DISTINCT ec.gmail_thread_id)::text AS total
         FROM email_communications ec
         JOIN candidates c ON c.id = ec.candidate_id
         LEFT JOIN applications a ON a.id = ec.ai_matched_application_id
         LEFT JOIN jobs j ON j.id = a.job_id
        WHERE ${whereSql}`,
      mainParams,
    ),
    // Count threads per ai_category using the SAME representative-row logic
    // as the thread list (most recent message per gmail_thread_id, thread_row=1).
    // This ensures each chip count matches exactly how many threads would appear
    // when that chip's filter is clicked — no over- or under-counting.
    query<{ category: string | null; count: number }>(
      `WITH thread_reps AS (
         SELECT ec.ai_category,
                ROW_NUMBER() OVER (
                  PARTITION BY ec.gmail_thread_id
                  ORDER BY ec.sent_at DESC, ec.id DESC
                ) AS thread_row
           FROM email_communications ec
           JOIN candidates c ON c.id = ec.candidate_id
           LEFT JOIN applications a ON a.id = ec.ai_matched_application_id
           LEFT JOIN jobs j ON j.id = a.job_id
          WHERE ${categoryWhereSql}
       )
       SELECT ai_category AS category, COUNT(*)::int AS count
         FROM thread_reps
        WHERE thread_row = 1
        GROUP BY ai_category
        ORDER BY count DESC`,
      catParams,
    ),
  ]);

  const offsetParam = addMain((page - 1) * pageSize);
  const limitParam = addMain(pageSize);
  const threads = await query<any>(
    `WITH filtered AS (
       SELECT ec.id, ec.candidate_id, c.name AS candidate_name, c.email AS candidate_email,
              ec.gmail_thread_id, ec.direction, ec.from_email, ec.to_emails,
              ec.subject, ec.snippet, ec.sent_at, ec.ai_relevant, ec.ai_category,
              ec.ai_confidence, ec.ai_summary, ec.ai_matched_application_id,
              ec.needs_reply, ec.replied_at, ec.triaged_at, ec.gmail_label_ids,
              ec.gmail_is_unread, ec.gmail_is_important, ec.attachment_metadata,
              ec.suppression_reason, ec.suppression_rule,
              (SELECT COUNT(*)::int
                 FROM action_items ai2
                 LEFT JOIN applications approval_app2 ON approval_app2.id = ai2.application_id
                WHERE ai2.email_communication_id = ec.id
                  AND ai2.status IN ('open', 'in_progress')
                  AND (ai2.type <> 'status_change_approval'
                       OR (ai2.application_id IS NOT NULL AND ai2.proposed_status IS NOT NULL
                           AND approval_app2.status IS DISTINCT FROM ai2.proposed_status))) AS open_task_count,
              j.title AS job_title, j.company AS company_name,
              COUNT(*) OVER (PARTITION BY ec.gmail_thread_id)::int AS message_count,
              ROW_NUMBER() OVER (PARTITION BY ec.gmail_thread_id ORDER BY ec.sent_at DESC, ec.id DESC) AS thread_row
         FROM email_communications ec
         JOIN candidates c ON c.id = ec.candidate_id
         LEFT JOIN applications a ON a.id = ec.ai_matched_application_id
         LEFT JOIN jobs j ON j.id = a.job_id
        WHERE ${whereSql}
     )
     SELECT * FROM filtered
      WHERE thread_row = 1
      ORDER BY sent_at DESC, id DESC
      OFFSET ${offsetParam} LIMIT ${limitParam}`,
    mainParams,
  );

  const total = Number(count?.total || 0);
  return NextResponse.json({
    threads,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    // Category counts scoped to the current active filters so the chips on
    // the inbox page always match what clicking them will actually return.
    categoryCounts: (categoryCounts ?? []).map((r) => ({ category: r.category, count: r.count })),
  });
}
