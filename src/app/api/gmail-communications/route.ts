import { NextRequest, NextResponse } from "next/server";
import { ALL_USER_ROLES, requireCurrentUser } from "@/lib/auth";
import { query, queryOne } from "@/server/db/neon";

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

  const params: unknown[] = [];
  const predicates = ["1=1"];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (direction === "inbox") {
    predicates.push(`ec.direction = 'inbound'`);
    predicates.push(`NOT EXISTS (SELECT 1 FROM action_items ai3 WHERE ai3.email_communication_id = ec.id AND ai3.type = 'status_change_approval' AND ai3.status IN ('open', 'in_progress'))`);
  }
  if (direction === "sent") predicates.push(`ec.direction = 'outbound'`);
  if (candidateId) predicates.push(`ec.candidate_id = ${add(candidateId)}`);
  if (category) predicates.push(`ec.ai_category = ${add(category)}`);
  if (needsReply) predicates.push(`ec.needs_reply = ${add(needsReply === "true")}`);
  if (relevant) {
    if (relevant === "true") {
      predicates.push(`ec.suppression_reason IS NULL`);
    } else {
      predicates.push(`ec.suppression_reason IS NOT NULL`);
    }
  }
  if (hasOpenTask) {
    const existsSql = `EXISTS (SELECT 1 FROM action_items ai2 WHERE ai2.email_communication_id = ec.id AND ai2.status IN ('open', 'in_progress'))`;
    predicates.push(hasOpenTask === "true" ? existsSql : `NOT ${existsSql}`);
  }
  if (search) {
    const term = `%${search}%`;
    const p = add(term);
    predicates.push(`(ec.subject ILIKE ${p} OR ec.from_email ILIKE ${p} OR ec.snippet ILIKE ${p} OR ec.body_text ILIKE ${p} OR c.name ILIKE ${p} OR ec.gmail_thread_id ILIKE ${p})`);
  }

  const whereSql = predicates.join(" AND ");
  const count = await queryOne<{ total: string }>(
    `SELECT COUNT(DISTINCT ec.gmail_thread_id)::text AS total
       FROM email_communications ec
       JOIN candidates c ON c.id = ec.candidate_id
      WHERE ${whereSql}`,
    params,
  );

  const offsetParam = add((page - 1) * pageSize);
  const limitParam = add(pageSize);
  const threads = await query<any>(
    `WITH filtered AS (
       SELECT ec.id, ec.candidate_id, c.name AS candidate_name, c.email AS candidate_email,
              ec.gmail_thread_id, ec.direction, ec.from_email, ec.to_emails,
              ec.subject, ec.snippet, ec.sent_at, ec.ai_relevant, ec.ai_category,
              ec.ai_confidence, ec.ai_summary, ec.ai_matched_application_id,
              ec.needs_reply, ec.replied_at, ec.triaged_at, ec.gmail_label_ids,
              ec.gmail_is_unread, ec.gmail_is_important, ec.attachment_metadata,
              ec.suppression_reason, ec.suppression_rule,
              (SELECT COUNT(*)::int FROM action_items ai2 WHERE ai2.email_communication_id = ec.id AND ai2.status IN ('open', 'in_progress')) AS open_task_count,
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
    params,
  );

  const total = Number(count?.total || 0);
  return NextResponse.json({ threads, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
}
