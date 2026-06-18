// src/app/api/cron/digest/route.ts
// GET -> generate and store the daily AI digest (see vercel.json for the schedule).
// Same CRON_SECRET bearer pattern as the other /api/cron/* routes; src/middleware.ts's
// generic /api/cron bypass already covers this path.

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { generateDailyDigest } from "@/lib/ai/digest";

export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await generateDailyDigest();
  if ("error" in result) return NextResponse.json(result, { status: 502 });

  const { error } = await supabase.from("ai_digests").insert({ content: result.content, provider: result.provider });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, provider: result.provider });
}
