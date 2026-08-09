import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { isEncryptionAvailable } from "@/server/security/secretCrypto";
import { googleConfigurationReadiness } from "@/server/runtimeConfig";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authorization = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET;
  const cronAuthorized = Boolean(cronSecret && authorization === `Bearer ${cronSecret}`);
  if (!cronAuthorized) {
    const { response } = await requireCurrentUser(["admin"]);
    if (response) return response;
  }

  const readiness = googleConfigurationReadiness();
  const tokenEncryptionReady = isEncryptionAvailable();
  return NextResponse.json({
    ...readiness,
    tokenEncryptionReady,
    ready: readiness.ready && tokenEncryptionReady,
  }, { status: readiness.ready && tokenEncryptionReady ? 200 : 503 });
}
