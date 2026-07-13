// src/app/api/notifications/[id]/read/route.ts
// POST -> mark a single notification as read

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/auth";
import { execute } from "@/server/db/neon";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const context = await getCurrentUserContext();
  if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  await execute(
    "UPDATE notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2",
    [params.id, context.profile.user_id]
  );
  return NextResponse.json({ ok: true });
}
