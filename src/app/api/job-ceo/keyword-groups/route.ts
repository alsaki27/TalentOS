import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export interface JobCeoKeywordGroup {
  id: string;
  label: string;
  keywords: string[];
  created_at: string;
}

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  try {
    const rows = await query<{ id: string; label: string; keywords: string; created_at: string }>(
      "SELECT id, label, keywords, created_at FROM job_agent_keyword_groups ORDER BY created_at DESC"
    );
    const groups = rows.map((r) => ({
      ...r,
      keywords: Array.isArray(r.keywords)
        ? r.keywords
        : JSON.parse(r.keywords || "[]"),
    }));
    return NextResponse.json(groups);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not load keyword groups" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  let body: { label?: string; keywords?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.label?.trim()) {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }
  if (!Array.isArray(body.keywords) || body.keywords.length === 0) {
    return NextResponse.json({ error: "keywords array is required" }, { status: 400 });
  }

  const cleanKeywords = body.keywords.map((k) => k.trim()).filter(Boolean);
  if (cleanKeywords.length === 0) {
    return NextResponse.json({ error: "At least one non-empty keyword is required" }, { status: 400 });
  }

  try {
    const rows = await query<JobCeoKeywordGroup>(
      "INSERT INTO job_agent_keyword_groups (label, keywords) VALUES ($1, $2) RETURNING *",
      [body.label.trim(), JSON.stringify(cleanKeywords)]
    );
    return NextResponse.json(rows[0], { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not create keyword group" }, { status: 500 });
  }
}
