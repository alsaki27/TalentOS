// src/app/api/interviews/[id]/scorecard/route.ts
// POST -> submit a scorecard for a panel member
// GET  -> get consensus scorecard (aggregate of all submitted scorecards)

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { isNeon } from "@/server/db";
import { query, queryOne, execute } from "@/server/db/neon";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const body = await req.json();
  if (!body.panelMemberId) {
    return NextResponse.json({ error: "panelMemberId is required" }, { status: 400 });
  }

  let data: any;
  let error: any;

  if (isNeon()) {
    data = await queryOne(
      `INSERT INTO interview_scorecards (schedule_id, panel_member_id, overall_rating, recommendation, competencies, overall_notes, verdict_notes, submitted_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        params.id,
        body.panelMemberId,
        body.overallRating ?? null,
        body.recommendation ?? null,
        body.competencies ?? [],
        body.overallNotes ?? null,
        body.verdictNotes ?? null,
        new Date().toISOString(),
      ]
    );
    error = data ? null : { message: "Insert failed" };
    if (!error) {
      await execute(
        `UPDATE interview_panel_members SET feedback_submitted = true WHERE id = $1`,
        [body.panelMemberId]
      );
    }
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("interview_scorecards")
      .insert({
        schedule_id: params.id,
        panel_member_id: body.panelMemberId,
        overall_rating: body.overallRating ?? null,
        recommendation: body.recommendation ?? null,
        competencies: body.competencies ?? [],
        overall_notes: body.overallNotes ?? null,
        verdict_notes: body.verdictNotes ?? null,
        submitted_at: new Date().toISOString(),
      })
      .select()
      .single();
    data = res.data;
    error = res.error;
    if (!error) {
      await supabase
        .from("interview_panel_members")
        .update({ feedback_submitted: true })
        .eq("id", body.panelMemberId);
    }
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logActivity({
    userId: context.profile.user_id,
    actorName: context.profile.display_name || context.profile.email || undefined,
    type: "create",
    description: `Submitted scorecard for interview ${params.id}`,
    entityType: "interview_scorecard",
    entityId: data.id,
    metadata: {
      overall_rating: body.overallRating,
      recommendation: body.recommendation,
    },
  });

  return NextResponse.json(data, { status: 201 });
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  let scorecards: any[];
  let error: any;

  if (isNeon()) {
    scorecards = await query(
      `SELECT * FROM interview_scorecards WHERE schedule_id = $1 ORDER BY submitted_at ASC`,
      [params.id]
    );
    error = null;
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("interview_scorecards")
      .select("*")
      .eq("schedule_id", params.id)
      .order("submitted_at", { ascending: true });
    scorecards = res.data ?? [];
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items = scorecards ?? [];

  // Aggregate overall rating
  const overallRatings = items
    .map((s: any) => s.overall_rating as number | null)
    .filter((r: any): r is number => r !== null && r !== undefined);
  const avgOverall = overallRatings.length > 0
    ? overallRatings.reduce((a: number, b: number) => a + b, 0) / overallRatings.length
    : 0;

  // Aggregate competencies
  const competencyMap = new Map<string, { sum: number; count: number; notes: string[] }>();
  for (const sc of items) {
    const comps = Array.isArray(sc.competencies) ? sc.competencies : [];
    for (const c of comps) {
      if (!c?.name) continue;
      const existing = competencyMap.get(c.name) ?? { sum: 0, count: 0, notes: [] };
      existing.sum += typeof c.rating === "number" ? c.rating : 0;
      existing.count += typeof c.rating === "number" ? 1 : 0;
      if (c.notes) existing.notes.push(c.notes);
      competencyMap.set(c.name, existing);
    }
  }
  const competencies = Array.from(competencyMap.entries()).map(([name, stats]) => ({
    name,
    average: stats.count > 0 ? stats.sum / stats.count : 0,
    count: stats.count,
    notes: stats.notes.slice(0, 5),
  }));

  // Recommendation distribution
  const recCounts: Record<string, number> = {};
  for (const sc of items) {
    if (sc.recommendation) {
      recCounts[sc.recommendation] = (recCounts[sc.recommendation] || 0) + 1;
    }
  }
  const recommendations = Object.entries(recCounts).map(([recommendation, count]) => ({
    recommendation,
    count,
  }));
  recommendations.sort((a, b) => b.count - a.count);

  // Verdict: hire/no_hire/split based on majority
  const hireRecs = ["strong_hire", "hire", "lean_hire"];
  const noHireRecs = ["no_hire", "strong_no_hire"];
  let hireCount = 0;
  let noHireCount = 0;
  for (const sc of items) {
    if (hireRecs.includes(sc.recommendation)) hireCount++;
    else if (noHireRecs.includes(sc.recommendation)) noHireCount++;
  }
  let verdict = "Split";
  if (hireCount > 0 && noHireCount === 0) verdict = "Hire";
  if (noHireCount > 0 && hireCount === 0) verdict = "No Hire";
  if (hireCount > noHireCount) verdict = "Hire";
  if (noHireCount > hireCount) verdict = "No Hire";

  return NextResponse.json({
    overallRating: avgOverall,
    overallRatingCount: overallRatings.length,
    competencies,
    recommendations,
    verdict,
    scorecards: items,
  });
}
