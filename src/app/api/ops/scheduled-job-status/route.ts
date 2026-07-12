import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { isNeon } from "@/server/db";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET() {
  const { response } = await requireCurrentUser();
  if (response) return response;

  if (isNeon()) {
    const rows = await query(
      `SELECT job_name, last_attempt_at, last_success_at, last_failure_at,
              last_error, last_duration_ms, last_result_summary
       FROM scheduled_job_runs
       ORDER BY job_name`,
      []
    );
    return NextResponse.json(rows ?? []);
  }

  return NextResponse.json([]);
}
