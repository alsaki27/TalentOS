// src/app/api/job-agent/configs/test/route.ts
// POST -> test an Apify token by calling /v2/user/me

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { testApifyToken } from "@/server/services/jobAgentService";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();
  const token = String(body.apifyToken ?? "").trim();

  if (!token) {
    return NextResponse.json({ error: "apifyToken is required" }, { status: 400 });
  }

  const result = await testApifyToken(token);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}