// src/app/api/jobs/[id]/comments/route.ts
// GET  -> newest internal comments for a job
// POST -> add an internal comment. Authenticated users are stored on the comment.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/auth";
import { isNeon } from "@/server/db";
import { query, queryOne } from "@/server/db/neon";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  let data: any;
  let error: any;

  if (isNeon()) {
    try {
      data = await query(
        `SELECT * FROM job_comments WHERE job_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [params.id]
      );
      error = null;
    } catch (err: any) {
      error = { message: err.message };
    }
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("job_comments")
      .select("*")
      .eq("job_id", params.id)
      .order("created_at", { ascending: false })
      .limit(50);
    data = res.data;
    error = res.error;
  }

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

  let data: any;
  let error: any;

  if (isNeon()) {
    try {
      data = await queryOne(
        `INSERT INTO job_comments (job_id, commenter_name, commenter_user_id, body) VALUES ($1, $2, $3, $4) RETURNING *`,
        [params.id, commenterName, currentUser?.profile.user_id ?? null, commentBody]
      );
      error = data ? null : { message: "Insert failed" };
    } catch (err: any) {
      error = { message: err.message };
    }
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("job_comments")
      .insert({
        job_id: params.id,
        commenter_name: commenterName,
        commenter_user_id: currentUser?.profile.user_id ?? null,
        body: commentBody,
      })
      .select()
      .single();
    data = res.data;
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
