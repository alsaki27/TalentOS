// src/app/api/job-agent/configs/[id]/route.ts
// Simplified — no token fields.

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { getConfigById, updateConfig, deleteConfig } from "@/server/repositories/jobAgentConfigRepository";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;
  try {
    const config = await getConfigById(params.id);
    if (!config) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(config);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;
  const body = await req.json();
  try {
    const updated = await updateConfig(params.id, {
      label: body.label !== undefined ? String(body.label).trim() : undefined,
      maxResults: body.maxResults !== undefined ? Number(body.maxResults) : undefined,
      roleGroups: Array.isArray(body.roleGroups) ? body.roleGroups : undefined,
      isActive: typeof body.isActive === "boolean" ? body.isActive : undefined,
    });
    return NextResponse.json(updated);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;
  try {
    const result = await deleteConfig(params.id);
    if (!result.ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}