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
      const rawMessage = String(error?.message || "");
      const timedOut = error?.name === "AbortError" || /aborted|timeout|timed out/i.test(rawMessage);
      const message = timedOut
        ? "Gemini keyword generation timed out. Try again, or check the agent route in AI Control Center."
        : rawMessage || "Keyword generation failed";
      const status = timedOut ? 504 : 502;
      return NextResponse.json({ error: message }, { status });
    }
  }

  const results = await generateAllActiveBaseResumeJobSearchProfiles({ userId: context!.profile.user_id });
  return NextResponse.json({ ok: true, mode: "all_active", results });
}
