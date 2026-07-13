// src/app/api/candidates/route.ts
// GET  -> paginated/filterable list of candidates
// POST -> create a new candidate

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { triggerWebhooks } from "@/lib/webhookEngine";
import { query, queryOne } from "@/server/db/neon";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const compact = url.searchParams.get("compact") === "1";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10) || 50));
  const search = (url.searchParams.get("search") || "").trim().replace(/[,()]/g, "");
  const status = url.searchParams.get("status") || "";
  const tier = url.searchParams.get("tier") || "";

  const offset = (page - 1) * pageSize;
  const searchParam = `%${search}%`;
  const columns = compact
    ? "c.id, c.name, c.resume_url, c.resume_filename, EXISTS(SELECT 1 FROM base_resumes br WHERE br.candidate_id = c.id) as has_base_resume"
    : "c.id, c.name, c.email, c.phone, c.status, c.target_tier, c.resume_filename, c.avatar_url, c.created_at";

  const dataSql = `
    SELECT ${columns} FROM candidates c
    WHERE ($1 = '' OR c.name ILIKE $2 OR c.email ILIKE $2)
      AND ($3 = '' OR c.status = $3)
      AND ($4 = '' OR c.target_tier = $4)
    ORDER BY c.created_at DESC
    OFFSET $5 LIMIT $6
  `;
  const countSql = `
    SELECT COUNT(*)::int as total FROM candidates
    WHERE ($1 = '' OR name ILIKE $2 OR email ILIKE $2)
      AND ($3 = '' OR status = $3)
      AND ($4 = '' OR target_tier = $4)
  `;

  try {
    const data = await query<Record<string, any>>(dataSql, [search, searchParam, status, tier, offset, pageSize]);
    const countRow = await queryOne<{ total: number }>(countSql, [search, searchParam, status, tier]);
    return NextResponse.json({ items: data ?? [], total: countRow?.total ?? 0, page, pageSize });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();

  if (!body.name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  try {
    const sql = `
      INSERT INTO candidates (name, email, phone, status, target_tier, notes, linkedin_url, github_url, portfolio_url, visa_status, target_industries, location_preference, work_mode_preference, available_start_date, target_roles)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *
    `;
    const data = await queryOne<Record<string, any>>(sql, [
      body.name,
      body.email ?? null,
      body.phone ?? null,
      body.status ?? "active",
      body.target_tier ?? null,
      body.notes ?? null,
      body.linkedin_url ?? null,
      body.github_url ?? null,
      body.portfolio_url ?? null,
      body.visa_status ?? null,
      body.target_industries ?? null,
      body.location_preference ?? null,
      body.work_mode_preference ?? null,
      body.available_start_date ?? null,
      body.target_roles ?? null,
    ]);
    if (!data) throw new Error("Insert failed");

    if (context && data) {
      await logActivity({
        userId: context.profile.user_id,
        actorName: context.profile.display_name || context.profile.email || undefined,
        type: "create",
        description: `Created candidate ${data.name}`,
        entityType: "candidate",
        entityId: data.id,
        entityName: data.name,
      });
      void triggerWebhooks("candidate.created", {
        candidate_id: data.id,
        name: data.name,
        email: data.email,
        created_by: context.profile.user_id,
      });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
