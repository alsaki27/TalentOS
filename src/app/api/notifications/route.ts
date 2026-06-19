// src/app/api/notifications/route.ts
// GET  -> legacy dashboard stats (no params) OR notification list (with pagination)
// POST -> create a notification (internal use)

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext, requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const context = await getCurrentUserContext();
  if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const url = new URL(req.url);
  const page = url.searchParams.get("page");

  // Legacy mode: no pagination params -> return queue/follow-up stats (NavBar badges)
  if (!page) {
    const today = new Date().toISOString().slice(0, 10);

    let queueQuery = supabase
      .from("applications")
      .select("id, assigned_to, assigned_to_user_id, assignment_due_at, review_status, priority")
      .in("status", ["assigned", "stacked", "in_progress"]);

    const { data: queueItems, error: queueError } = await queueQuery;
    if (queueError) return NextResponse.json({ error: queueError.message }, { status: 500 });

    const visibleQueue = context.profile.role === "application_engineer"
      ? (queueItems ?? []).filter((item) => (
        item.assigned_to_user_id === context.profile.user_id
        || item.assigned_to === context.profile.display_name
        || item.assigned_to === context.profile.email
      ))
      : (queueItems ?? []);

    const { data: dueFollowUps, error: followUpError } = await supabase
      .from("applications")
      .select("id, assigned_to, assigned_to_user_id")
      .not("follow_up_at", "is", null)
      .lte("follow_up_at", today);

    if (followUpError) return NextResponse.json({ error: followUpError.message }, { status: 500 });

    const visibleFollowUps = context.profile.role === "application_engineer"
      ? (dueFollowUps ?? []).filter((item) => (
        item.assigned_to_user_id === context.profile.user_id
        || item.assigned_to === context.profile.display_name
        || item.assigned_to === context.profile.email
      ))
      : (dueFollowUps ?? []);

    return NextResponse.json({
      queue: {
        total: visibleQueue.length,
        overdue: visibleQueue.filter((item) => item.assignment_due_at && item.assignment_due_at <= today).length,
        urgent: visibleQueue.filter((item) => item.priority === "urgent").length,
        pendingReview: visibleQueue.filter((item) => item.review_status === "pending").length,
      },
      followUps: {
        due: visibleFollowUps.length,
      },
    });
  }

  // New notification list mode
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10) || 20));
  const type = url.searchParams.get("type") || "";
  const unreadOnly = url.searchParams.get("unread") === "1";

  let query = supabase
    .from("notifications")
    .select("*", { count: "exact" })
    .eq("user_id", context.profile.user_id)
    .order("created_at", { ascending: false });

  if (type) query = query.eq("type", type);
  if (unreadOnly) query = query.is("read_at", null);

  const from = (pageNum - 1) * pageSize;
  const { data, error, count } = await query.range(from, from + pageSize - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ notifications: data ?? [], total: count ?? 0, page: pageNum, pageSize });
}

export async function POST(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const body = await req.json();

  const { data, error } = await supabase
    .from("notifications")
    .insert({
      user_id: body.user_id,
      type: body.type ?? "info",
      title: body.title,
      body: body.body ?? null,
      link: body.link ?? null,
      entity_type: body.entity_type ?? null,
      entity_id: body.entity_id ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
