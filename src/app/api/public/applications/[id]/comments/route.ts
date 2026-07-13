import { NextRequest, NextResponse } from "next/server";
import { requirePublicApiScope } from "@/lib/publicApiAuth";
import { queryOne } from "@/server/db/neon";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requirePublicApiScope(req, "applications:comment");
  if (response) return response;

  const body = await req.json();
  const bodyText = String(body.body ?? "").trim();
  if (!bodyText) return NextResponse.json({ error: "body is required" }, { status: 400 });

  let data: any;
  let error: any;

  data = await queryOne(
    `INSERT INTO application_comments (application_id, commenter_name, body, visible_to_candidate, parent_comment_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [params.id, body.commenter_name || context?.name || "Public API", bodyText, Boolean(body.visible_to_candidate), body.parent_comment_id || null]
  );
  error = data ? null : { message: "Insert failed" };

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
