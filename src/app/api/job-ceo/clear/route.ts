import { NextResponse } from "next/server";
import { execute } from "@/server/db/neon";

export async function GET() {
  try {
    await execute("DELETE FROM job_ceo_staging");
    await execute("DELETE FROM job_ceo_runs");
    await execute("DELETE FROM job_ceo_seen_signatures");
    await execute("DELETE FROM jobs WHERE source = 'openjobdata'");
    
    return NextResponse.json({ success: true, message: "All Job CEO run history has been cleared successfully!" });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
