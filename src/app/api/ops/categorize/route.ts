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
import { processPendingCategorization } from "@/lib/ai/jobCategorization";

export const dynamic = "force-dynamic";

export async function GET() {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const [{ count: pendingCount }, needsReview, recentRuns, categories] = await Promise.all([
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("category_status", "pending"),
    supabase.from("jobs").select("id, title, company, ai_suggested_category, category_relevance_score")
      .eq("category_status", "needs_review").order("categorized_at", { ascending: false }).limit(50),
    supabase.from("categorization_runs").select("*").order("started_at", { ascending: false }).limit(10),
    supabase.from("job_categories").select("id, label, description, is_active").order("label", { ascending: true }),
  ]);

  return NextResponse.json({
    pendingCount: pendingCount ?? 0,
    needsReview: needsReview.data ?? [],
    recentRuns: recentRuns.data ?? [],
    categories: categories.data ?? [],
  });
}

export async function POST(req: NextRequest) {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const body = await req.json().catch(() => ({}));
  const action = body.action ?? "process";

  if (action === "process") {
    const result = await processPendingCategorization({ limit: 20, triggeredBy: "manual" });
    return NextResponse.json(result);
  }

  if (action === "requeue_all") {
    const { error, count } = await supabase
      .from("jobs")
      .update({ category_status: "pending", job_category: null, ai_suggested_category: null }, { count: "exact" })
      .in("category_status", ["done", "needs_review"]);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ requeued: count ?? 0 });
  }

  if (action === "approve_category" || action === "assign_category") {
    const jobId = body.jobId as string | undefined;
    const label = (body.label as string | undefined)?.trim();
    if (!jobId || !label) {
      return NextResponse.json({ error: "jobId and label are required" }, { status: 400 });
    }

    if (action === "approve_category") {
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

    const { data, error } = await supabase
      .from("jobs")
      .update({ job_category: label, ai_suggested_category: null, category_status: "done" })
      .eq("id", jobId)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
