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
import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { query, queryOne, execute } from "@/server/db/neon";
import { processPendingCategorization } from "@/lib/ai/jobCategorization";

export const dynamic = "force-dynamic";

export async function GET() {
  const { response } = await requireCurrentUser();
  if (response) return response;

  let pendingCount: number;
  let needsReview: any[];
  let recentRuns: any[];
  let categories: any[];

  if (isNeon()) {
    const pendingRes = await queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM jobs WHERE category_status = $1 OR category_status IS NULL',
      ['pending']
    );
    pendingCount = parseInt(pendingRes?.count ?? '0', 10);

    needsReview = await query(
      'SELECT id, title, company, ai_suggested_category, category_relevance_score FROM jobs WHERE category_status = $1 ORDER BY categorized_at DESC LIMIT $2',
      ['needs_review', 50]
    );

    recentRuns = await query(
      'SELECT * FROM categorization_runs ORDER BY started_at DESC LIMIT $1',
      [10]
    );

    categories = await query(
      'SELECT id, label, description, is_active FROM job_categories ORDER BY label ASC',
      []
    );
  } else {
    const [{ count: pendingCountRes }, needsReviewRes, recentRunsRes, categoriesRes] = await Promise.all([
      supabase.from("jobs").select("id", { count: "exact", head: true }).or('category_status.eq.pending,category_status.is.null'),
      supabase.from("jobs").select("id, title, company, ai_suggested_category, category_relevance_score")
        .eq("category_status", "needs_review").order("categorized_at", { ascending: false }).limit(50),
      supabase.from("categorization_runs").select("*").order("started_at", { ascending: false }).limit(10),
      supabase.from("job_categories").select("id, label, description, is_active").order("label", { ascending: true }),
    ]);

    pendingCount = pendingCountRes ?? 0;
    needsReview = needsReviewRes.data ?? [];
    recentRuns = recentRunsRes.data ?? [];
    categories = categoriesRes.data ?? [];
  }

  return NextResponse.json({
    pendingCount,
    needsReview,
    recentRuns,
    categories,
  });
}

export async function POST(req: NextRequest) {
  const { response } = await requireCurrentUser();
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
    if (isNeon()) {
      const res = await execute(
        "UPDATE jobs SET category_status = $1, job_category = NULL, ai_suggested_category = NULL WHERE category_status = ANY($2) OR category_status IS NULL",
        ["pending", ["done", "needs_review"]]
      );
      return NextResponse.json({ requeued: res.rowCount });
    } else {
      const { error, count } = await supabase
        .from("jobs")
        .update({ category_status: "pending", job_category: null, ai_suggested_category: null }, { count: "exact" })
        .or('category_status.in.("done","needs_review"),category_status.is.null');
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ requeued: count ?? 0 });
    }
  }

  if (action === "approve_category" || action === "assign_category") {
    const jobId = body.jobId as string | undefined;
    const label = (body.label as string | undefined)?.trim();
    if (!jobId || !label) {
      return NextResponse.json({ error: "jobId and label are required" }, { status: 400 });
    }

    if (action === "approve_category") {
      if (isNeon()) {
        try {
          await execute(
            'INSERT INTO job_categories (label) VALUES ($1)',
            [label]
          );
        } catch (err: any) {
          // Ignore unique-violation (category already exists) — assigning still proceeds.
          if (err.code !== '23505') {
            return NextResponse.json({ error: err.message }, { status: 500 });
          }
        }
      } else {
        const { error: insertError } = await supabase
          .from("job_categories")
          .insert({ label })
          .select()
          .single();
        // Ignore unique-violation (category already exists) — assigning still proceeds.
        if (insertError && insertError.code !== "23505") {
          return NextResponse.json({ error: insertError.message }, { status: 500 });
        }
      }
    }

    if (isNeon()) {
      const data = await queryOne(
        'UPDATE jobs SET job_category = $1, ai_suggested_category = NULL, category_status = $2 WHERE id = $3 RETURNING *',
        [label, 'done', jobId]
      );
      if (!data) return NextResponse.json({ error: 'Update failed' }, { status: 500 });
      return NextResponse.json(data);
    } else {
      const { data, error } = await supabase
        .from("jobs")
        .update({ job_category: label, ai_suggested_category: null, category_status: "done" })
        .eq("id", jobId)
        .select()
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json(data);
    }
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
