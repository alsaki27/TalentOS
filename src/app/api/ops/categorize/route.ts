// src/app/api/ops/categorize/route.ts
// GET  -> job categorization status snapshot: pending count, needs-review queue,
//         recent categorization_runs, active category list (admin-only, mirrors
//         src/app/api/ops/digests/route.ts's "recent + generate now" pattern).
// POST -> one of:
//   { action: "process" }                    run one batch of pending jobs now
//   { action: "requeue_all" }                 reset done/needs_review jobs back to
//                                              pending (e.g. after editing the taxonomy)
//   { action: "approve_category", jobId, label }  add a needs_review job's AI-suggested
//                                              category as a permanent new category
//   { action: "assign_category", jobId, label }   manually assign an existing category
//                                              to a needs_review (or any) job

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query, queryOne, execute } from "@/server/db/neon";
import { processPendingCategorization } from "@/lib/ai/jobCategorization";

export const dynamic = "force-dynamic";

export async function GET() {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const pendingRes = await queryOne<{ count: string }>(
    'SELECT COUNT(*) as count FROM jobs WHERE category_status = $1 OR category_status IS NULL',
    ['pending']
  );
  const pendingCount = parseInt(pendingRes?.count ?? '0', 10);

  const needsReview = await query(
    'SELECT id, title, company, ai_suggested_category, category_relevance_score FROM jobs WHERE category_status = $1 ORDER BY categorized_at DESC LIMIT $2',
    ['needs_review', 50]
  );

  const recentRuns = await query(
    'SELECT * FROM categorization_runs ORDER BY started_at DESC LIMIT $1',
    [10]
  );

  const categories = await query(
    'SELECT id, label, description, is_active FROM job_categories ORDER BY label ASC',
    []
  );

  return NextResponse.json({
    pendingCount,
    needsReview,
    recentRuns,
    categories,
  });
}

export async function POST(req: NextRequest) {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const body = await req.json().catch(() => ({}));
  const action = body.action ?? "process";

  if (action === "process") {
    try {
      const result = await processPendingCategorization({ limit: body.limit, triggeredBy: "manual" });
      return NextResponse.json(result);
    } catch (err: any) {
      console.error("Categorization process error:", err);
      return NextResponse.json({ error: err.message ?? "Unknown categorization error" }, { status: 500 });
    }
  }

  if (action === "requeue_all") {
    const res = await execute(
      "UPDATE jobs SET category_status = $1, job_category = NULL, ai_suggested_category = NULL WHERE category_status = ANY($2) OR category_status IS NULL",
      ["pending", ["done", "needs_review"]]
    );
    return NextResponse.json({ requeued: res.rowCount });
  }

  if (action === "approve_category" || action === "assign_category") {
    const jobId = body.jobId as string | undefined;
    const label = (body.label as string | undefined)?.trim();
    if (!jobId || !label) {
      return NextResponse.json({ error: "jobId and label are required" }, { status: 400 });
    }

    if (action === "approve_category") {
      try {
        await execute(
          'INSERT INTO job_categories (label) VALUES ($1)',
          [label]
        );
      } catch (err: any) {
        if (err.code !== '23505') {
          return NextResponse.json({ error: err.message }, { status: 500 });
        }
      }
    }

    const data = await queryOne(
      'UPDATE jobs SET job_category = $1, ai_suggested_category = NULL, category_status = $2 WHERE id = $3 RETURNING *',
      [label, 'done', jobId]
    );
    if (!data) return NextResponse.json({ error: 'Update failed' }, { status: 500 });
    return NextResponse.json(data);
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
