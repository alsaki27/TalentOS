import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext, ALL_USER_ROLES } from "@/lib/auth";
import { runGmailSync } from "@/server/services/gmailSyncService";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  var currentUser = await getCurrentUserContext();
  if (!currentUser) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!ALL_USER_ROLES.includes(currentUser.profile.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const result = await runGmailSync();
    return NextResponse.json({ success: true, result });
  } catch (error: any) {
    console.error("[Force Sync API] Error:", error);
    return NextResponse.json({ error: "Failed to force sync emails", details: error.message }, { status: 500 });
  }
}
