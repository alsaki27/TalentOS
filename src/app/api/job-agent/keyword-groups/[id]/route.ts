// src/app/api/job-agent/keyword-groups/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { getKeywordGroupById, updateKeywordGroup, deleteKeywordGroup } from "@/server/repositories/jobAgentKeywordGroupRepository";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;
  const g = await getKeywordGroupById(params.id);
  if (!g) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(g);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;
  const body = await req.json();
  try {
    const g = await updateKeywordGroup(
      params.id,
      body.label !== undefined ? String(body.label).trim() : undefined,
      Array.isArray(body.keywords) ? body.keywords.map(String).map((s: string) => s.trim()).filter(Boolean) : undefined
    );
    return NextResponse.json(g);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;
  await deleteKeywordGroup(params.id);
  return NextResponse.json({ ok: true });
}