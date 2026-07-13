// src/app/api/job-agent/configs/route.ts
// Simplified — no token handling.

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { listConfigs, updateConfig, getDefaultConfig } from "@/server/repositories/jobAgentConfigRepository";

export const dynamic = "force-dynamic";

export async function GET() {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;
  try {
    const configs = await listConfigs();
    return NextResponse.json(configs);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;
  const body = await req.json();
  try {
    const config = await getDefaultConfig();
    const updated = await updateConfig(config.id, {
      maxResults: body.maxResults !== undefined ? Number(body.maxResults) : undefined,
      roleGroups: Array.isArray(body.roleGroups) ? body.roleGroups : undefined,
      isActive: typeof body.isActive === "boolean" ? body.isActive : undefined,
    });
    return NextResponse.json(updated);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}