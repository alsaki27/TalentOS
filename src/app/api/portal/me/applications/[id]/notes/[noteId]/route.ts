import { NextResponse } from "next/server";
import { requireCurrentCandidate } from "@/server/auth/candidateAuth";
import { execute, queryOne } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: { id: string; noteId: string } }) {
  const { context, response } = await requireCurrentCandidate();
  if (response) return response;
  const body = await request.json().catch(() => ({}));
  const note = typeof body.body === "string" ? body.body.trim() : "";
  if (!note || note.length > 5000) return NextResponse.json({ error: "Note must be between 1 and 5000 characters" }, { status: 400 });
  const updated = await queryOne(
    `UPDATE candidate_application_notes
     SET body = $1, updated_at = NOW()
     WHERE id = $2 AND application_id = $3 AND candidate_id = $4
     RETURNING id, body, created_at, updated_at`,
    [note, params.noteId, params.id, context.candidateId],
  );
  if (!updated) return NextResponse.json({ error: "Note not found" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: { params: { id: string; noteId: string } }) {
  const { context, response } = await requireCurrentCandidate();
  if (response) return response;
  const result = await execute(
    `DELETE FROM candidate_application_notes
     WHERE id = $1 AND application_id = $2 AND candidate_id = $3`,
    [params.noteId, params.id, context.candidateId],
  );
  if (result.rowCount === 0) return NextResponse.json({ error: "Note not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
