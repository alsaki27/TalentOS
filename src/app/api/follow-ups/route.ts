// src/app/api/follow-ups/route.ts
// GET -> paginated/filterable follow-ups, joined with candidate + job info

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/auth";
import { query, queryOne } from "@/server/db/neon";
import { sanitizeError } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const context = await getCurrentUserContext();
  if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10) || 50));
  const search = (url.searchParams.get("search") || "").trim().replace(/[,()]/g, "");
  const status = url.searchParams.get("status") || "";
  const dueFilter = url.searchParams.get("dueFilter") || "";

  const userId = context.profile.user_id;
  const userEmail = context.profile.email ?? null;
  const userDisplayName = context.profile.display_name ?? null;
  const userRole = context.profile.role;
  const today = new Date().toISOString().slice(0, 10);

  try {
    const offset = (page - 1) * pageSize;
    const searchParam = `%${search}%`;

    const dataSql = `
      SELECT a.id, a.status, a.follow_up_at, a.follow_up_source, a.follow_up_created_at,
        a.assigned_to, a.assigned_to_user_id, a.next_action,
        jsonb_build_object('id', c.id, 'name', c.name) as candidates,
        jsonb_build_object('id', j.id, 'title', j.title, 'company', j.company) as jobs
      FROM applications a
      LEFT JOIN candidates c ON a.candidate_id = c.id
      LEFT JOIN jobs j ON a.job_id = j.id
      WHERE a.follow_up_at IS NOT NULL
        AND ($1 <> 'application_engineer' OR a.assigned_to_user_id::text IS NOT DISTINCT FROM $2::text OR ($3::text IS NOT NULL AND a.assigned_to IS NOT DISTINCT FROM $3::text) OR ($4::text IS NOT NULL AND a.assigned_to IS NOT DISTINCT FROM $4::text))
        AND ($5 = '' OR c.name ILIKE $6 OR j.title ILIKE $6 OR j.company ILIKE $6)
        AND ($7 = '' OR a.status = $7)
        AND ($8 = '' OR a.follow_up_at <= $8::date)
        AND ($9 = '' OR a.follow_up_at > $9::date)
      ORDER BY a.follow_up_at ASC
      OFFSET $10 LIMIT $11
    `;

    const countSql = `
      SELECT COUNT(*)::int as total
      FROM applications a
      LEFT JOIN candidates c ON a.candidate_id = c.id
      LEFT JOIN jobs j ON a.job_id = j.id
      WHERE a.follow_up_at IS NOT NULL
        AND ($1 <> 'application_engineer' OR a.assigned_to_user_id::text IS NOT DISTINCT FROM $2::text OR ($3::text IS NOT NULL AND a.assigned_to IS NOT DISTINCT FROM $3::text) OR ($4::text IS NOT NULL AND a.assigned_to IS NOT DISTINCT FROM $4::text))
        AND ($5 = '' OR c.name ILIKE $6 OR j.title ILIKE $6 OR j.company ILIKE $6)
        AND ($7 = '' OR a.status = $7)
        AND ($8 = '' OR a.follow_up_at <= $8::date)
        AND ($9 = '' OR a.follow_up_at > $9::date)
    `;

    const data = await query<Record<string, any>>(dataSql, [
      userRole,
      userId,
      userEmail,
      userDisplayName,
      search,
      searchParam,
      status,
      dueFilter === "overdue" ? today : "",
      dueFilter === "upcoming" ? today : "",
      offset,
      pageSize,
    ]);

    const countRow = await queryOne<{ total: number }>(countSql, [
      userRole,
      userId,
      userEmail,
      userDisplayName,
      search,
      searchParam,
      status,
      dueFilter === "overdue" ? today : "",
      dueFilter === "upcoming" ? today : "",
    ]);

    const statsBaseWhere = `
      a.follow_up_at IS NOT NULL
      AND ($1 <> 'application_engineer' OR a.assigned_to_user_id::text IS NOT DISTINCT FROM $2::text OR ($3::text IS NOT NULL AND a.assigned_to IS NOT DISTINCT FROM $3::text) OR ($4::text IS NOT NULL AND a.assigned_to IS NOT DISTINCT FROM $4::text))
    `;
    const statsBaseParams = [userRole, userId, userEmail, userDisplayName];

    const [allRow, dueRow, upcomingRow, autoRow] = await Promise.all([
      queryOne<{ total: number }>(`SELECT COUNT(*)::int as total FROM applications a WHERE ${statsBaseWhere}`, statsBaseParams),
      queryOne<{ total: number }>(`SELECT COUNT(*)::int as total FROM applications a WHERE ${statsBaseWhere} AND a.follow_up_at <= $5::date`, [...statsBaseParams, today]),
      queryOne<{ total: number }>(`SELECT COUNT(*)::int as total FROM applications a WHERE ${statsBaseWhere} AND a.follow_up_at > $5::date`, [...statsBaseParams, today]),
      queryOne<{ total: number }>(`SELECT COUNT(*)::int as total FROM applications a WHERE ${statsBaseWhere} AND a.follow_up_source = 'auto_status_rule'`, statsBaseParams),
    ]);

    const stats = {
      all: allRow?.total ?? 0,
      due: dueRow?.total ?? 0,
      upcoming: upcomingRow?.total ?? 0,
      auto: autoRow?.total ?? 0,
      manual: (allRow?.total ?? 0) - (autoRow?.total ?? 0),
    };

    return NextResponse.json({ items: data ?? [], total: countRow?.total ?? 0, page, pageSize, stats });
  } catch (error: unknown) {
    const { message, status } = sanitizeError(error);
    return NextResponse.json({ error: message }, { status });
  }
}
