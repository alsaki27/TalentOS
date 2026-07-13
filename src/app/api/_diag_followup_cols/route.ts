import { NextResponse } from "next/server";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

// TEMP diagnostic route - remove after use. Not linked from any UI.
export async function GET() {
  try {
    const cols = await query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'applications' AND column_name LIKE 'follow_up%' ORDER BY column_name`
    );
    return NextResponse.json({ ok: true, cols });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err), stack: err?.stack?.slice(0, 2000) }, { status: 500 });
  }
}
