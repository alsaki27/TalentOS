import { NextRequest, NextResponse } from "next/server";
import { pickFields, requirePublicApiScope } from "@/lib/publicApiAuth";
import { queryOne, execute } from "@/server/db/neon";
import { findCandidateById } from "@/server/repositories/candidatesRepository";
import { listApplicationsForCandidate } from "@/server/repositories/applicationsRepository";

const CANDIDATE_FIELDS = [
  "name", "email", "phone", "status", "target_tier", "notes", "resume_url",
  "resume_filename", "target_roles", "preferred_locations", "salary_expectation",
  "work_authorization", "avatar_url",
];

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "candidates:read");
  if (response) return response;

  const candidate = await findCandidateById(params.id);
  if (!candidate) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const applications = await listApplicationsForCandidate(params.id);
    return NextResponse.json({ ...candidate, applications: applications ?? [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "candidates:write");
  if (response) return response;

  const updates = pickFields(await req.json(), CANDIDATE_FIELDS);

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }
  updates.updated_at = new Date().toISOString();
  const keys = Object.keys(updates);
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  const values = keys.map((k) => (updates as any)[k]);
  values.push(params.id);
  try {
    const data = await queryOne<any>(`UPDATE candidates SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`, values);
    if (!data) return NextResponse.json({ error: "Update failed" }, { status: 500 });
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "candidates:delete");
  if (response) return response;

  try {
    await execute("DELETE FROM candidates WHERE id = $1", [params.id]);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
