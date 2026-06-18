// src/app/api/applications/[id]/comments/route.ts
// GET  -> newest activity-log comments for an application
// POST -> add a comment. Mark visible_to_candidate to surface it on the candidate portal.
// parent_comment_id makes a comment a threaded reply — pass the id of the comment being
// replied to. Replies inherit no special behavior; they're just another row pointing at
// their parent, same flat table, so existing readers ignore it (parent_comment_id: null)
// unless they're updated to render a thread.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { data, error } = await supabase
    .from("application_comments")
    .select("*")
    .eq("application_id", params.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const currentUser = await getCurrentUserContext();
  const commenterName = body.commenter_name?.trim()
    || currentUser?.profile.display_name
    || currentUser?.profile.email;
  const commentBody = body.body?.trim();

  if (!commenterName) {
    return NextResponse.json({ error: "commenter_name is required" }, { status: 400 });
  }
  if (!commentBody) {
    return NextResponse.json({ error: "comment body is required" }, { status: 400 });
  }

  const parentCommentId = body.parent_comment_id ? String(body.parent_comment_id) : null;
  if (parentCommentId) {
    const { data: parent } = await supabase
      .from("application_comments")
      .select("id")
      .eq("id", parentCommentId)
      .eq("application_id", params.id)
      .maybeSingle();
    if (!parent) {
      return NextResponse.json({ error: "parent_comment_id must belong to the same application" }, { status: 400 });
    }
  }

  const { data, error } = await supabase
    .from("application_comments")
    .insert({
      application_id: params.id,
      commenter_name: commenterName,
      commenter_user_id: currentUser?.profile.user_id ?? null,
      body: commentBody,
      visible_to_candidate: Boolean(body.visible_to_candidate),
      parent_comment_id: parentCommentId,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
