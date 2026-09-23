// src/app/api/job-agent/role-library/route.ts
// GET -> returns the full role library with groups, titles, and resume families

import { NextResponse } from "next/server";
import { requireCurrentUser, MASTER_DATA_MANAGER_ROLES } from "@/lib/auth";
import { getAllGroups, getTotalTitleCount, getCombinedGroups } from "@/lib/jobAgentRoleLibrary";

export const dynamic = "force-dynamic";

export async function GET() {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  return NextResponse.json({
    groups: getAllGroups(),
    combinedGroups: getCombinedGroups(),
    totalTitles: getTotalTitleCount(),
  });
}