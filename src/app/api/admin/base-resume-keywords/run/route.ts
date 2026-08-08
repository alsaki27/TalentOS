import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import {
  generateAllActiveBaseResumeJobSearchProfiles,
  generateBaseResumeJobSearchProfile,
} from "@/server/services/baseResumeJobSearchKeywordService";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json().catch(() => ({}));
  const baseResumeId = typeof body.baseResumeId === "string" ? body.baseResumeId : "";

  if (baseResumeId) {
    try {
      const result = await generateBaseResumeJobSearchProfile({
        baseResumeId,
        triggerType: "manual",
        userId: context!.profile.user_id,
      });
      return NextResponse.json({ ok: true, mode: "single", result });
    } catch (error: any) {
      return NextResponse.json({ error: error?.message || "Keyword generation failed" }, { status: 502 });
    }
  }

  const results = await generateAllActiveBaseResumeJobSearchProfiles({ userId: context!.profile.user_id });
  return NextResponse.json({ ok: true, mode: "all_active", results });
}
