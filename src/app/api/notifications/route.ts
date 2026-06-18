import { NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function GET() {
  const context = await getCurrentUserContext();
  if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

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
