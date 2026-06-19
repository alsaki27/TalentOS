// src/app/api/portal/[token]/route.ts
// GET -> read-only candidate portal data, looked up by magic-link token (no login).
// Deliberately returns a minimal slice: name + submitted applications (not pre-submission
// assigned/stacked/in_progress pipeline tickets) + only comments flagged
// visible_to_candidate. Internal notes, assignment metadata, and other candidates'
// data are never exposed here.

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const PIPELINE_STATUSES = new Set(["assigned", "stacked", "in_progress"]);

function publicStatus(status: string) {
  if (status === "interview") return { stage: "interview", label: "Interview stage" };
  if (status === "offer") return { stage: "offer", label: "Offer received" };
  if (status === "rejected" || status === "withdrawn") return { stage: "closed", label: "Closed" };
  if (status === "replied") return { stage: "waiting", label: "Employer responded" };
  return { stage: "submitted", label: "Submitted" };
}

// Same definitions as the internal /api/analytics endpoint, scoped to one candidate.
function rate(count: number, total: number): number {
  return total === 0 ? 0 : Math.round((count / total) * 1000) / 10;
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const { data: candidate, error: candErr } = await supabase
    .from("candidates")
    .select("id, name, portal_token_expires_at, portal_token_revoked_at")
    .eq("portal_token", params.token)
    .single();

  if (candErr || !candidate) {
    return NextResponse.json({ error: "Portal link not found." }, { status: 404 });
  }
  if (
    candidate.portal_token_revoked_at
    || (candidate.portal_token_expires_at && new Date(candidate.portal_token_expires_at).getTime() < Date.now())
  ) {
    return NextResponse.json({ error: "Portal link expired." }, { status: 410 });
  }

  const { data: applications, error: appErr } = await supabase
    .from("applications")
    .select("id, status, applied_at, jobs(id, title, company, location)")
    .eq("candidate_id", candidate.id)
    .order("applied_at", { ascending: false });

  if (appErr) return NextResponse.json({ error: appErr.message }, { status: 500 });

  const submitted = (applications ?? []).filter((a: any) => !PIPELINE_STATUSES.has(a.status as string));
  const appIds = submitted.map((a: any) => a.id as string);

  const { data: comments, error: commentsErr } = appIds.length
    ? await supabase
        .from("application_comments")
        .select("id, application_id, body, parent_comment_id, created_at")
        .in("application_id", appIds)
        .eq("visible_to_candidate", true)
        .order("created_at", { ascending: false })
    : { data: [], error: null };

  if (commentsErr) return NextResponse.json({ error: commentsErr.message }, { status: 500 });

  const commentsByApp = new Map<string, { id: string; body: string; created_at: string }[]>();
  for (const c of comments ?? []) {
    const list = commentsByApp.get(c.application_id) ?? [];
    list.push(c);
    commentsByApp.set(c.application_id, list);
  }

  const respondedCount = submitted.filter((a: any) => a.status !== "applied").length;
  const interviewCount = submitted.filter((a: any) => a.status === "interview" || a.status === "offer").length;
  const offerCount = submitted.filter((a: any) => a.status === "offer").length;

  return NextResponse.json({
    name: candidate.name,
    stats: {
      totalApplications: submitted.length,
      interviews: interviewCount,
      offers: offerCount,
      responseRate: rate(respondedCount, submitted.length),
    },
    applications: submitted.map((a: any) => ({
      id: a.id,
      status: a.status,
      public_status: publicStatus(a.status),
      applied_at: a.applied_at,
      job: a.jobs,
      updates: commentsByApp.get(a.id) ?? [],
    })),
  });
}
