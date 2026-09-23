import { NextResponse } from "next/server";
import { requireCurrentCandidate } from "@/server/auth/candidateAuth";
import { execute, query, queryOne } from "@/server/db/neon";

export const dynamic = "force-dynamic";

async function ownsApplication(candidateId: string, applicationId: string) {
  return queryOne<{ id: string }>(
    `SELECT a.id FROM applications a
     WHERE a.id = $1 AND a.candidate_id = $2
       AND CASE WHEN a.ae_stage = 'applied' THEN 'applied' ELSE a.status END NOT IN ('assigned', 'stacked', 'in_progress')`,
    [applicationId, candidateId],
  );
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentCandidate();
  if (response) return response;
  if (!(await ownsApplication(context.candidateId, params.id))) return NextResponse.json({ error: "Application not found" }, { status: 404 });
  const notes = await query(
    `SELECT id, body, created_at, updated_at
     FROM candidate_application_notes
     WHERE candidate_id = $1 AND application_id = $2
     ORDER BY updated_at DESC`,
    [context.candidateId, params.id],
  );
  return NextResponse.json({ notes });
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentCandidate();
  if (response) return response;
  if (!(await ownsApplication(context.candidateId, params.id))) return NextResponse.json({ error: "Application not found" }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const note = typeof body.body === "string" ? body.body.trim() : "";
  if (!note || note.length > 5000) return NextResponse.json({ error: "Note must be between 1 and 5000 characters" }, { status: 400 });
  const created = await queryOne(
    `INSERT INTO candidate_application_notes (candidate_id, application_id, body)
     VALUES ($1, $2, $3) RETURNING id, body, created_at, updated_at`,
    [context.candidateId, params.id, note],
  );
  return NextResponse.json(created, { status: 201 });
}
