import { NextResponse } from "next/server";
import { GET as getTeamMembers } from "../members/route";

// Compatibility endpoint retained for any admin page loaded from an older
// TalentOS deployment during a rolling update.
export async function GET() {
  const response = await getTeamMembers();
  if (!response.ok) return response;
  const body = await response.json();
  return NextResponse.json({ ...body, engineers: body.teamMembers });
}
