import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext, ALL_USER_ROLES } from "@/lib/auth";
import { runGmailSync } from "@/server/services/gmailSyncService";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  var currentUser = await getCurrentUserContext();
  if (!currentUser) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!ALL_USER_ROLES.includes(currentUser.profile.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    // Manual sync is also the recovery path after a transient Google API or
    // token error. Scheduled sync intentionally skips errored accounts so it
    // does not hammer a broken credential every 20 minutes.
    const result = await runGmailSync({ retryErrored: true });
    return NextResponse.json({ success: true, result });
  } catch (error: any) {
    console.error("[Force Sync API] Error:", error);
    return NextResponse.json({ error: "Failed to force sync emails", details: error.message }, { status: 500 });
  }
}
