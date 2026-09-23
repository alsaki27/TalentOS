import { NextResponse } from "next/server";
import { getCurrentUserContext, publicUserProfile } from "@/lib/auth";

// Keep the session bootstrap URL separate from /api/auth/* because privacy and
// ad-blocking extensions commonly block URLs containing the word "auth".
export async function GET() {
  const context = await getCurrentUserContext();
  if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  return NextResponse.json({
    user: { id: context.user.id, email: context.user.email },
    profile: publicUserProfile(context.profile),
  });
}
