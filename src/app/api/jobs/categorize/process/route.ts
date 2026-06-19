// src/app/api/jobs/categorize/process/route.ts
// POST -> process one bounded batch of pending job categorizations. Called repeatedly
// by the browser right after an import reports imported > 0 (see src/app/jobs/page.tsx)
// — the client keeps calling this until remainingPending hits 0, which is more reliable
// than a server-side fire-and-forget call here, since a Vercel serverless function can
// be torn down shortly after this response flushes. Same role gate as the import routes
// (MASTER_DATA_MANAGER_ROLES) since this is part of the import workflow.

import { NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { processPendingCategorization } from "@/lib/ai/jobCategorization";

export const dynamic = "force-dynamic";

export async function POST() {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const result = await processPendingCategorization({ limit: 5, triggeredBy: "import" });
  return NextResponse.json(result);
}
