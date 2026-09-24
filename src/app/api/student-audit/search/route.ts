import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query } from "@/server/db/neon";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  if (!q) return NextResponse.json({ results: [] });

  try {
    const results = await query(
      `SELECT id, name, domain, target_role, rating
       FROM student_audit_students WHERE name ILIKE $1 ORDER BY name ASC LIMIT 25`,
      [`%${q}%`]
    );
    return NextResponse.json({ results });
  } catch (err: any) {
    console.error("GET student-audit search error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
