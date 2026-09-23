// src/app/api/job-agent/runs/[id]/route.ts
// GET -> run details with staged job counts by tier/group

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { getRunById } from "@/server/repositories/jobAgentRunRepository";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  try {
    const run = await getRunById(params.id);
    if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(run);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not load run" }, { status: 500 });
  }
}