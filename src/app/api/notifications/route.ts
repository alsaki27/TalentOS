// src/app/api/notifications/route.ts
// GET  -> legacy dashboard stats (no params) OR notification list (with pagination)
// POST -> create a notification (internal use)

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext, requireCurrentUser } from "@/lib/auth";
import { isNeon } from "@/server/db";
import { query, queryOne, execute } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const context = await getCurrentUserContext();
  if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const url = new URL(req.url);
  const page = url.searchParams.get("page");

  // Legacy mode: no pagination params -> return queue/follow-up stats (NavBar badges)
  if (!page) {
    const today = new Date().toISOString().slice(0, 10);

    if (isNeon()) {
      const queueItems = await query(
        `SELECT id, assigned_to, assigned_to_user_id, assignment_due_at, review_status, priority
         FROM applications WHERE status IN ('assigned', 'stacked', 'in_progress')`
      );

      const visibleQueue = context.profile.role === "application_engineer"
        ? (queueItems ?? []).filter((item: any) => (
          item.assigned_to_user_id === context.profile.user_id
          || item.assigned_to === context.profile.display_name
          || item.assigned_to === context.profile.email
        ))
        : (queueItems ?? []);

      const dueFollowUps = await query(
        `SELECT id, assigned_to, assigned_to_user_id
         FROM applications WHERE follow_up_at IS NOT NULL AND follow_up_at <= $1`,
        [today]
      );

      const visibleFollowUps = context.profile.role === "application_engineer"
        ? (dueFollowUps ?? []).filter((item: any) => (
          item.assigned_to_user_id === context.profile.user_id
          || item.assigned_to === context.profile.display_name
          || item.assigned_to === context.profile.email
        ))
        : (dueFollowUps ?? []);

      return NextResponse.json({
        queue: {
          total: visibleQueue.length,
          overdue: visibleQueue.filter((item: any) => item.assignment_due_at && item.assignment_due_at <= today).length,
          urgent: visibleQueue.filter((item: any) => item.priority === "urgent").length,
          pendingReview: visibleQueue.filter((item: any) => item.review_status === "pending").length,
        },
        followUps: {
          due: visibleFollowUps.length,
        },
      });
    } else {
      // Legacy Supabase path
      const { supabase } = await import("@/lib/supabase");
      let queueQuery = supabase
        .from("applications")
        .select("id, assigned_to, assigned_to_user_id, assignment_due_at, review_status, priority")
        .in("status", ["assigned", "stacked", "in_progress"]);

      const { data: queueItems, error: queueError } = await queueQuery;
      if (queueError) return NextResponse.json({ error: queueError.message }, { status: 500 });

      const visibleQueue = context.profile.role === "application_engineer"
        ? (queueItems ?? []).filter((item: any) => (
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
        ? (dueFollowUps ?? []).filter((item: any) => (
          item.assigned_to_user_id === context.profile.user_id
          || item.assigned_to === context.profile.display_name
          || item.assigned_to === context.profile.email
        ))
        : (dueFollowUps ?? []);

      return NextResponse.json({
        queue: {
          total: visibleQueue.length,
          overdue: visibleQueue.filter((item: any) => item.assignment_due_at && item.assignment_due_at <= today).length,
          urgent: visibleQueue.filter((item: any) => item.priority === "urgent").length,
          pendingReview: visibleQueue.filter((item: any) => item.review_status === "pending").length,
        },
        followUps: {
          due: visibleFollowUps.length,
        },
      });
    }
  }

  // New notification list mode
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10) || 20));
  const type = url.searchParams.get("type") || "";
  const unreadOnly = url.searchParams.get("unread") === "1";

  if (isNeon()) {
    const conditions: string[] = ["user_id = $1"];
    const values: any[] = [context.profile.user_id];
    let paramIdx = 2;

    if (type) {
      conditions.push(`type = $${paramIdx++}`);
      values.push(type);
    }
    if (unreadOnly) {
      conditions.push("read_at IS NULL");
    }

    const where = conditions.join(" AND ");
    const countRow = await queryOne<{ total: number }>(
      `SELECT COUNT(*)::int as total FROM notifications WHERE ${where}`,
      [...values]
    );

    const offset = (pageNum - 1) * pageSize;
    const notifications = await query(
      `SELECT * FROM notifications WHERE ${where} ORDER BY created_at DESC OFFSET $${paramIdx++} LIMIT $${paramIdx++}`,
      [...values, offset, pageSize]
    );

    return NextResponse.json({
      notifications: notifications ?? [],
      total: countRow?.total ?? 0,
      page: pageNum,
      pageSize,
    });
  } else {
    const { supabase } = await import("@/lib/supabase");
    let sbQuery = supabase
      .from("notifications")
      .select("*", { count: "exact" })
      .eq("user_id", context.profile.user_id)
      .order("created_at", { ascending: false });

    if (type) sbQuery = sbQuery.eq("type", type);
    if (unreadOnly) sbQuery = sbQuery.is("read_at", null);

    const from = (pageNum - 1) * pageSize;
    const { data, error, count } = await sbQuery.range(from, from + pageSize - 1);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ notifications: data ?? [], total: count ?? 0, page: pageNum, pageSize });
  }
}

export async function POST(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const body = await req.json();

  if (isNeon()) {
    const result = await queryOne(
      `INSERT INTO notifications (user_id, type, title, body, link, entity_type, entity_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        body.user_id,
        body.type ?? "info",
        body.title,
        body.body ?? null,
        body.link ?? null,
        body.entity_type ?? null,
        body.entity_id ?? null,
      ]
    );
    return NextResponse.json(result, { status: 201 });
  } else {
    const { supabase } = await import("@/lib/supabase");
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
}
