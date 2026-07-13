// src/app/api/job-agent/tokens/route.ts
// GET  -> list tokens (masked)
// POST -> add a new Apify token to the pool

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser, DESTRUCTIVE_MANAGER_ROLES } from "@/lib/auth";
import { listTokens, insertToken, deactivateToken, activateToken } from "@/server/repositories/jobAgentTokenRepository";

export const dynamic = "force-dynamic";

export async function GET() {
  const { response } = await requireCurrentUser(DESTRUCTIVE_MANAGER_ROLES);
  if (response) return response;
  try {
    const tokens = await listTokens();
    return NextResponse.json(tokens);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { response } = await requireCurrentUser(DESTRUCTIVE_MANAGER_ROLES);
  if (response) return response;
  const body = await req.json();
  const token = String(body.token ?? "").trim();
  const label = body.label ? String(body.label).trim() : null;
  if (!token) return NextResponse.json({ error: "token is required" }, { status: 400 });
  try {
    const row = await insertToken(label, token, body.priority);
    return NextResponse.json({ id: row.id, label: row.label, priority: row.priority, is_active: row.is_active }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PATCH -> toggle a token's is_active flag.
// Body: { id: string, is_active: boolean }
export async function PATCH(req: NextRequest) {
  const { response } = await requireCurrentUser(DESTRUCTIVE_MANAGER_ROLES);
  if (response) return response;
  const body = await req.json();
  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const makeActive = Boolean(body.is_active);
  try {
    if (makeActive) await activateToken(id);
    else await deactivateToken(id);
    return NextResponse.json({ id, is_active: makeActive });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}