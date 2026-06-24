// src/app/api/follow-ups/route.ts
// GET -> paginated/filterable follow-ups, joined with candidate + job info

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { query, queryOne } from "@/server/db/neon";

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

  if (isNeon()) {
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
          AND ($1 <> 'application_engineer' OR a.assigned_to_user_id IS NOT DISTINCT FROM $2 OR ($3 IS NOT NULL AND a.assigned_to IS NOT DISTINCT FROM $3) OR ($4 IS NOT NULL AND a.assigned_to IS NOT DISTINCT FROM $4))
          AND ($5 = '' OR c.name ILIKE $6 OR j.title ILIKE $6 OR j.company ILIKE $6)
          AND ($7 = '' OR a.status = $7)
          AND ($8 = '' OR a.follow_up_at <= $8)
          AND ($9 = '' OR a.follow_up_at > $9)
        ORDER BY a.follow_up_at ASC
        OFFSET $10 LIMIT $11
      `;

      const countSql = `
        SELECT COUNT(*)::int as total
        FROM applications a
        LEFT JOIN candidates c ON a.candidate_id = c.id
        LEFT JOIN jobs j ON a.job_id = j.id
        WHERE a.follow_up_at IS NOT NULL
          AND ($1 <> 'application_engineer' OR a.assigned_to_user_id IS NOT DISTINCT FROM $2 OR ($3 IS NOT NULL AND a.assigned_to IS NOT DISTINCT FROM $3) OR ($4 IS NOT NULL AND a.assigned_to IS NOT DISTINCT FROM $4))
          AND ($5 = '' OR c.name ILIKE $6 OR j.title ILIKE $6 OR j.company ILIKE $6)
          AND ($7 = '' OR a.status = $7)
          AND ($8 = '' OR a.follow_up_at <= $8)
          AND ($9 = '' OR a.follow_up_at > $9)
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
        AND ($1 <> 'application_engineer' OR a.assigned_to_user_id IS NOT DISTINCT FROM $2 OR ($3 IS NOT NULL AND a.assigned_to IS NOT DISTINCT FROM $3) OR ($4 IS NOT NULL AND a.assigned_to IS NOT DISTINCT FROM $4))
      `;
      const statsBaseParams = [userRole, userId, userEmail, userDisplayName];

      const [allRow, dueRow, upcomingRow, autoRow] = await Promise.all([
        queryOne<{ total: number }>(`SELECT COUNT(*)::int as total FROM applications a WHERE ${statsBaseWhere}`, statsBaseParams),
        queryOne<{ total: number }>(`SELECT COUNT(*)::int as total FROM applications a WHERE ${statsBaseWhere} AND a.follow_up_at <= $5`, [...statsBaseParams, today]),
        queryOne<{ total: number }>(`SELECT COUNT(*)::int as total FROM applications a WHERE ${statsBaseWhere} AND a.follow_up_at > $5`, [...statsBaseParams, today]),
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
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  let dbQuery = supabase
    .from("applications")
    .select("id, status, follow_up_at, follow_up_source, follow_up_created_at, assigned_to, assigned_to_user_id, next_action, candidates(id, name), jobs(id, title, company)", { count: "exact" })
    .not("follow_up_at", "is", null)
    .order("follow_up_at", { ascending: true });

  if (context.profile.role === "application_engineer") {
    const ownerFilters = [
      `assigned_to_user_id.eq.${context.profile.user_id}`,
      context.profile.email ? `assigned_to.eq.${context.profile.email}` : "",
      context.profile.display_name ? `assigned_to.eq.${context.profile.display_name}` : "",
    ].filter(Boolean).join(",");
    dbQuery = dbQuery.or(ownerFilters);
  }

  if (search) {
    dbQuery = dbQuery.or(`candidates.name.ilike.%${search}%,jobs.title.ilike.%${search}%,jobs.company.ilike.%${search}%`);
  }
  if (status) dbQuery = dbQuery.eq("status", status);

  if (dueFilter === "overdue") dbQuery = dbQuery.lte("follow_up_at", today);
  if (dueFilter === "upcoming") dbQuery = dbQuery.gt("follow_up_at", today);

  const from = (page - 1) * pageSize;
  const { data, error, count } = await dbQuery.range(from, from + pageSize - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Compute cross-page stats
  function buildStatsBase() {
    let q = supabase.from("applications").select("id", { count: "exact", head: true })
      .not("follow_up_at", "is", null);
    if (context!.profile.role === "application_engineer") {
      const ownerFilters = [
        `assigned_to_user_id.eq.${context!.profile.user_id}`,
        context!.profile.email ? `assigned_to.eq.${context!.profile.email}` : "",
        context!.profile.display_name ? `assigned_to.eq.${context!.profile.display_name}` : "",
      ].filter(Boolean).join(",");
      q = q.or(ownerFilters);
    }
    return q;
  }

  const [allRes, dueRes, upcomingRes, autoRes] = await Promise.all([
    buildStatsBase(),
    buildStatsBase().lte("follow_up_at", today),
    buildStatsBase().gt("follow_up_at", today),
    buildStatsBase().eq("follow_up_source", "auto_status_rule"),
  ]);

  const stats = {
    all: allRes.count ?? 0,
    due: dueRes.count ?? 0,
    upcoming: upcomingRes.count ?? 0,
    auto: autoRes.count ?? 0,
    manual: (allRes.count ?? 0) - (autoRes.count ?? 0),
  };

  return NextResponse.json({ items: data ?? [], total: count ?? 0, page, pageSize, stats });
}
