import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query } from "@/server/db/neon";

export async function GET() {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;
  const teamMembers = await query<{ user_id: string; display_name: string | null; email: string; role: string }>(
    `SELECT user_id, display_name, email, role
       FROM profiles
      WHERE is_active = true
      ORDER BY display_name NULLS LAST, email`,
  );
  return NextResponse.json({ teamMembers });
}
