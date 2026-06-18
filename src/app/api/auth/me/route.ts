import { NextResponse } from "next/server";
import { getCurrentUserContext, publicUserProfile } from "@/lib/auth";

export async function GET() {
  const context = await getCurrentUserContext();
  if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  return NextResponse.json({
    user: { id: context.user.id, email: context.user.email },
    profile: publicUserProfile(context.profile),
  });
}
