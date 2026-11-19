import { NextResponse } from "next/server";
import { testConnection } from "@/server/db/neon";

export async function GET() {
  const start = Date.now();
  let healthy = false;
  try {
    healthy = (await testConnection()).ok;
  } catch {
    healthy = false;
  }

  return NextResponse.json(
    {
      status: healthy ? "ok" : "error",
      duration_ms: Date.now() - start,
    },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}
