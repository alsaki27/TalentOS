import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query } from "@/server/db/neon";

export async function GET() {
  const { response } = await requireCurrentUser();
  if (response) return response;

  try {
    const rows = await query<{ domain: string }>(
      `SELECT DISTINCT domain FROM student_audit_students WHERE domain IS NOT NULL AND domain != '' ORDER BY domain ASC`
    );
    return NextResponse.json({ domains: rows.map((r) => r.domain) });
  } catch (err: any) {
    console.error("GET student-audit domains error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
