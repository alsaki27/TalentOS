// src/app/api/candidates/route.ts
// GET  -> paginated/filterable list of candidates
// POST -> create a new candidate

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { triggerWebhooks } from "@/lib/webhookEngine";
import { query, queryOne } from "@/server/db/neon";
import { isMissingPostgresColumn } from "@/server/db/schemaCompatibility";
import { isCandidatePipelineStage } from "@/lib/candidatePipeline";

interface StudentAuditEnrichmentRow {
  candidate_id: string;
  rating: string;
  progress: number;
  mock_interviews: number;
}

interface OptApprovalEnrichmentRow {
  candidate_id: string;
  approval_date: string | null;
}

/**
 * Attaches audit_status/audit_progress/audit_mock_interviews to each candidate
 * row for the /candidates list columns, from the local student_audit_students
 * table (kept in sync by scripts/importStudentAudit.mjs). Best-effort: any
 * failure here (e.g. the tables don't exist yet) leaves candidates without
 * audit fields rather than failing the whole list request.
 */
async function enrichWithStudentAudit(rows: Record<string, any>[]): Promise<Record<string, any>[]> {
  if (rows.length === 0) return rows;
  try {
    const ids = rows.map((r) => r.id);
    const enrichment = await query<StudentAuditEnrichmentRow>(
      `SELECT l.candidate_id, s.rating, s.progress, s.mock_interviews
       FROM student_audit_links l
       JOIN student_audit_students s ON s.id = l.audit_student_id
       WHERE l.candidate_id = ANY($1)`,
      [ids]
    );
    if (enrichment.length === 0) return rows;

    const byCandidateId = new Map(enrichment.map((e) => [e.candidate_id, e]));
    return rows.map((row) => {
      const e = byCandidateId.get(row.id);
      if (!e) return row;
      return { ...row, audit_status: e.rating, audit_progress: e.progress, audit_mock_interviews: e.mock_interviews };
    });
  } catch (err) {
    console.error("[Candidates list] student-audit enrichment failed:", err);
    return rows;
  }
}

/** Adds the approval date only for the full candidates list that requests OPT days. */
async function enrichWithOptApproval(rows: Record<string, any>[]): Promise<Record<string, any>[]> {
  if (rows.length === 0) return rows;
  try {
    const approvals = await query<OptApprovalEnrichmentRow>(
      `SELECT candidate_id, approval_date::text AS approval_date
         FROM candidate_opt_status
        WHERE candidate_id = ANY($1)`,
      [rows.map((row) => row.id)],
    );
    const byCandidateId = new Map(approvals.map((row) => [row.candidate_id, row.approval_date]));
    return rows.map((row) => ({ ...row, opt_approval_date: byCandidateId.get(row.id) ?? null }));
  } catch (err) {
    console.error("[Candidates list] OPT approval enrichment failed:", err);
    return rows.map((row) => ({ ...row, opt_approval_date: null }));
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const compact = url.searchParams.get("compact") === "1";
  const includeOptDays = url.searchParams.get("includeOptDays") === "1";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10) || 50));
  const search = (url.searchParams.get("search") || "").trim().replace(/[,()]/g, "");
  const status = url.searchParams.get("status") || "";
  const tier = url.searchParams.get("tier") || "";
  const pipelineStage = url.searchParams.get("pipelineStage") || "";
  const hasContractParam = url.searchParams.get("hasContract");
  const hasContract = hasContractParam === "yes" ? true : hasContractParam === "no" ? false : null;
  const showPlaced = url.searchParams.get("showPlaced") === "1";
  const showDropped = url.searchParams.get("showDropped") === "1";
  // Placed and dropped candidates are hidden by default - most work happens
  // on the still-active roster - unless a tick box opts one back in, or the
  // stage dropdown explicitly asks for exactly that one stage.
  const hiddenStages: string[] = [];
  if (!showPlaced) hiddenStages.push("placed");
  if (!showDropped) hiddenStages.push("dropped");

  const offset = (page - 1) * pageSize;
  const searchParam = `%${search}%`;
  // Actively-applying candidates surface first, then not-started, then placed, then dropped last.
  const stageOrder = `CASE c.pipeline_stage
      WHEN 'applying' THEN 0
      WHEN 'not_started' THEN 1
      WHEN 'paused' THEN 2
      WHEN 'placed' THEN 3
      WHEN 'dropped' THEN 4
      ELSE 5
    END`;

  async function loadPage(hasContractColumn: boolean) {
    const columns = compact
      ? "c.id, c.name, c.resume_url, c.resume_filename, EXISTS(SELECT 1 FROM base_resumes br WHERE br.candidate_id = c.id) as has_base_resume"
      : `c.id, c.name, c.email, c.phone, c.status, c.pipeline_stage, c.target_tier, c.resume_filename, c.avatar_url, c.created_at, ${hasContractColumn ? "c.has_contract" : "TRUE AS has_contract"}`;
    const contractFilter = hasContractColumn ? "AND ($6::boolean IS NULL OR c.has_contract = $6)" : "";
    const offsetParam = hasContractColumn ? 7 : 6;
    const limitParam = hasContractColumn ? 8 : 7;
    const hiddenStagesParam = hasContractColumn ? 9 : 8;
    const countHiddenStagesParam = hasContractColumn ? 7 : 6;
    const dataSql = `
      SELECT ${columns} FROM candidates c
      WHERE ($1 = '' OR c.name ILIKE $2 OR c.email ILIKE $2)
        AND ($3 = '' OR c.status = $3)
        AND ($4 = '' OR c.target_tier = $4)
        AND ($5 = '' OR c.pipeline_stage = $5)
        ${contractFilter}
        AND ($5 <> '' OR c.pipeline_stage <> ALL($${hiddenStagesParam}::text[]))
      ORDER BY ${stageOrder}, c.name ASC
      OFFSET $${offsetParam} LIMIT $${limitParam}
    `;
    const countSql = `
      SELECT COUNT(*)::int as total FROM candidates c
      WHERE ($1 = '' OR c.name ILIKE $2 OR c.email ILIKE $2)
        AND ($3 = '' OR c.status = $3)
        AND ($4 = '' OR c.target_tier = $4)
        AND ($5 = '' OR c.pipeline_stage = $5)
        ${hasContractColumn ? "AND ($6::boolean IS NULL OR c.has_contract = $6)" : ""}
        AND ($5 <> '' OR c.pipeline_stage <> ALL($${countHiddenStagesParam}::text[]))
    `;
    const dataParams = hasContractColumn
      ? [search, searchParam, status, tier, pipelineStage, hasContract, offset, pageSize, hiddenStages]
      : [search, searchParam, status, tier, pipelineStage, offset, pageSize, hiddenStages];
    const countParams = hasContractColumn
      ? [search, searchParam, status, tier, pipelineStage, hasContract, hiddenStages]
      : [search, searchParam, status, tier, pipelineStage, hiddenStages];

    const [data, countRow] = await Promise.all([
      query<Record<string, any>>(dataSql, dataParams),
      queryOne<{ total: number }>(countSql, countParams),
    ]);
    return { data, countRow };
  }

  try {
    let result: Awaited<ReturnType<typeof loadPage>>;
    try {
      result = await loadPage(true);
    } catch (error) {
      if (!isMissingPostgresColumn(error, "has_contract")) throw error;
      // Migration 117 is additive and still pending. Older rows are defined to
      // have contracts, so keep the existing candidate list available while
      // the migration is scheduled. The `No contract` filter cannot match until
      // the new column exists.
      result = hasContract === false
        ? { data: [], countRow: { total: 0 } }
        : await loadPage(false);
    }

    const { data, countRow } = result;
    const auditItems = compact ? (data ?? []) : await enrichWithStudentAudit(data ?? []);
    const items = !compact && includeOptDays ? await enrichWithOptApproval(auditItems) : auditItems;
    return NextResponse.json({ items, total: countRow?.total ?? 0, page, pageSize });
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

  if (typeof body.has_contract !== "boolean") {
    return NextResponse.json({ error: "Select whether this candidate has a signed Skarion agreement." }, { status: 400 });
  }

  if (body.pipeline_stage !== undefined && !isCandidatePipelineStage(body.pipeline_stage)) {
    return NextResponse.json({ error: "Invalid candidate pipeline stage" }, { status: 400 });
  }

  try {
    const values = [
      body.name,
      body.email ?? null,
      body.phone ?? null,
      body.status ?? "active",
      body.pipeline_stage ?? "not_started",
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
      body.has_contract,
    ];
    const sql = `
      INSERT INTO candidates (name, email, phone, status, pipeline_stage, target_tier, notes, linkedin_url, github_url, portfolio_url, visa_status, target_industries, location_preference, work_mode_preference, available_start_date, target_roles, has_contract)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING *
    `;
    let hasContractColumn = true;
    let data: Record<string, any> | null;
    try {
      data = await queryOne<Record<string, any>>(sql, values);
    } catch (error) {
      if (!isMissingPostgresColumn(error, "has_contract")) throw error;
      if (!body.has_contract) {
        return NextResponse.json({ error: "The candidate contract database update is required before creating a candidate marked No. No candidate was created." }, { status: 503 });
      }
      hasContractColumn = false;
      data = await queryOne<Record<string, any>>(
        `INSERT INTO candidates (name, email, phone, status, pipeline_stage, target_tier, notes, linkedin_url, github_url, portfolio_url, visa_status, target_industries, location_preference, work_mode_preference, available_start_date, target_roles)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING *`,
        values.slice(0, 16),
      );
    }
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

    return NextResponse.json(hasContractColumn ? data : { ...data, has_contract: true }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
