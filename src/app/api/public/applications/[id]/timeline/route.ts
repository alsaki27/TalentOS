import { NextRequest, NextResponse } from "next/server";
import { requirePublicApiScope } from "@/lib/publicApiAuth";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "applications:read");
  if (response) return response;

  const [{ data: events, error: eventsError }, { data: comments, error: commentsError }] = await Promise.all([
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

  if (eventsError) return NextResponse.json({ error: eventsError.message }, { status: 500 });
  if (commentsError) return NextResponse.json({ error: commentsError.message }, { status: 500 });

  const timeline = [
    ...(events ?? []).map((event: any) => ({ kind: "status_event", ...event })),
    ...(comments ?? []).map((comment: any) => ({ kind: "comment", ...comment })),
  ].sort((a: any, b: any) => new Date(b.created_at as string).getTime() - new Date(a.created_at as string).getTime());

  return NextResponse.json({ data: timeline });
}
