// src/app/api/jobs/[id]/comments/route.ts
// GET  -> newest internal comments for a job
// POST -> add an internal comment. Authenticated users are stored on the comment.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { data, error } = await supabase
    .from("job_comments")
    .select("*")
    .eq("job_id", params.id)
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

  const { data, error } = await supabase
    .from("job_comments")
    .insert({
      job_id: params.id,
      commenter_name: commenterName,
      commenter_user_id: currentUser?.profile.user_id ?? null,
      body: commentBody,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
