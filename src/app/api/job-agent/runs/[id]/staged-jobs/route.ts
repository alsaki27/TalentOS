// src/app/api/job-agent/runs/[id]/staged-jobs/route.ts
// GET  -> paginated staged jobs for this run
// POST -> update status of one or more staged jobs (approve/reject)

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import {
  listStagedJobs,
  updateStagedJobStatus,
  bulkUpdateStagedJobStatus,
} from "@/server/repositories/jobAgentRunRepository";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const url = new URL(req.url);
  const tier = url.searchParams.get("tier") || undefined;
  const group = url.searchParams.get("group") || undefined;
  const importStatus = url.searchParams.get("importStatus") || undefined;
  const search = url.searchParams.get("search") || undefined;
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10) || 50));

  try {
    const result = await listStagedJobs(params.id, { tier, group, importStatus, search, page, pageSize });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not load staged jobs" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();
  const status = String(body.status ?? "").trim();
  const jobId = body.jobId ? String(body.jobId) : undefined;
  const jobIds = Array.isArray(body.jobIds) ? body.jobIds.map(String) : undefined;
  const tier = body.tier ? String(body.tier) : undefined;

  if (!status || !["approved", "rejected", "staged"].includes(status)) {
    return NextResponse.json({ error: "status must be approved, rejected, or staged" }, { status: 400 });
  }

  try {
    if (jobId) {
      await updateStagedJobStatus(jobId, status);
      return NextResponse.json({ updated: 1 });
    }

    if (jobIds && jobIds.length > 0) {
      const updated = await bulkUpdateStagedJobStatus(params.id, status, { jobIds });
      return NextResponse.json({ updated });
    }

    if (tier) {
      const updated = await bulkUpdateStagedJobStatus(params.id, status, { tier });
      return NextResponse.json({ updated });
    }

    return NextResponse.json({ error: "jobId, jobIds, or tier is required" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Update failed" }, { status: 500 });
  }
}