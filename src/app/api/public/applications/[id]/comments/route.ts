import { NextRequest, NextResponse } from "next/server";
import { requirePublicApiScope } from "@/lib/publicApiAuth";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requirePublicApiScope(req, "applications:comment");
  if (response) return response;

  const body = await req.json();
  const bodyText = String(body.body ?? "").trim();
  if (!bodyText) return NextResponse.json({ error: "body is required" }, { status: 400 });

  const { data, error } = await supabase
    .from("application_comments")
    .insert({
      application_id: params.id,
      commenter_name: body.commenter_name || context?.name || "Public API",
      body: bodyText,
      visible_to_candidate: Boolean(body.visible_to_candidate),
      parent_comment_id: body.parent_comment_id || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
