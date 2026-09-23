// src/app/api/job-agent/runs/[id]/approve/route.ts
// POST -> approve staged jobs and import them into the main jobs table

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { importApprovedJobs } from "@/lib/jobAgentImporter";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();
  const tier = body.tier ? String(body.tier) : undefined;
  const tiers = Array.isArray(body.tiers) ? body.tiers.map(String) : undefined;
  const jobIds = Array.isArray(body.jobIds) ? body.jobIds.map(String) : undefined;
  const approveAll = body.approveAll === true;

  if (!tier && !tiers && !jobIds && !approveAll) {
    return NextResponse.json(
      { error: "tier, tiers, jobIds, or approveAll is required" },
      { status: 400 }
    );
  }

  try {
    const result = await importApprovedJobs(params.id, { tier: tier as any, tiers, jobIds, approveAll });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Import failed" }, { status: 500 });
  }
}