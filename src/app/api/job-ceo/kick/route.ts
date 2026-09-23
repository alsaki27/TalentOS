import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { backgroundDispatch } from "@/server/lib/waitUntil";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const baseUrl = process.env.TALENTOS_BASE_URL || "https://talent.skarion.com";
  const cronSecret = process.env.CRON_SECRET;
  
  await backgroundDispatch(
    fetch(`${baseUrl}/api/job-ceo/dispatch`, {
      method: "POST",
      headers: cronSecret ? { Authorization: `Bearer ${cronSecret}` } : undefined
    }).catch((err) => {
      console.error("[Job CEO] Kick dispatch failed:", err);
    })
  );

  return NextResponse.json({ success: true });
}
