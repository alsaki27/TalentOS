// src/app/api/job-agent/keyword-groups/route.ts
import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { listKeywordGroups, createKeywordGroup } from "@/server/repositories/jobAgentKeywordGroupRepository";

export const dynamic = "force-dynamic";

export async function GET() {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;
  try {
    const groups = await listKeywordGroups();
    return NextResponse.json(groups);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;
  const body = await req.json();
  const label = String(body.label ?? "").trim();
  const keywords: string[] = Array.isArray(body.keywords) ? (body.keywords as any[]).map(String).map((s: string) => s.trim()).filter(Boolean) : [];
  if (!label) return NextResponse.json({ error: "label is required" }, { status: 400 });
  if (keywords.length === 0) return NextResponse.json({ error: "keywords are required" }, { status: 400 });
  try {
    const group = await createKeywordGroup(label, keywords);
    return NextResponse.json(group, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}