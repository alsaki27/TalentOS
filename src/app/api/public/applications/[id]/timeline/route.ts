import { NextRequest, NextResponse } from "next/server";
import { requirePublicApiScope } from "@/lib/publicApiAuth";
import { isNeon } from "@/server/db";
import { query } from "@/server/db/neon";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "applications:read");
  if (response) return response;

  let events: any[];
  let comments: any[];
  let eventsError: any;
  let commentsError: any;

  if (isNeon()) {
    [events, comments] = await Promise.all([
      query(
        `SELECT id, from_status, to_status, note, created_at FROM application_events WHERE application_id = $1 ORDER BY created_at DESC`,
        [params.id]
      ),
      query(
        `SELECT id, commenter_name, body, visible_to_candidate, parent_comment_id, created_at FROM application_comments WHERE application_id = $1 ORDER BY created_at DESC`,
        [params.id]
      ),
    ]);
    eventsError = null;
    commentsError = null;
  } else {
    const { supabase } = await import("@/lib/supabase");
    const [eventsRes, commentsRes] = await Promise.all([
      supabase
        .from("application_events")
        .select("id, from_status, to_status, note, created_at")
        .eq("application_id", params.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("application_comments")
        .select("id, commenter_name, body, visible_to_candidate, parent_comment_id, created_at")
        .eq("application_id", params.id)
        .order("created_at", { ascending: false }),
    ]);
    events = eventsRes.data ?? [];
    comments = commentsRes.data ?? [];
    eventsError = eventsRes.error;
    commentsError = commentsRes.error;
  }

  if (eventsError) return NextResponse.json({ error: eventsError.message }, { status: 500 });
  if (commentsError) return NextResponse.json({ error: commentsError.message }, { status: 500 });

  const timeline = [
    ...(events ?? []).map((event: any) => ({ kind: "status_event", ...event })),
    ...(comments ?? []).map((comment: any) => ({ kind: "comment", ...comment })),
  ].sort((a: any, b: any) => new Date(b.created_at as string).getTime() - new Date(a.created_at as string).getTime());

  return NextResponse.json({ data: timeline });
}
