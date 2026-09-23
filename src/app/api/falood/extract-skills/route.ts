// src/app/api/falood/extract-skills/route.ts
// Extracts required skills + company name from a pasted JD for the Falood
// tailor studio. Routed through the app's real AI provider system
// (src/server/services/faloodAiService.ts) instead of a hardcoded,
// quota-exhausted OpenAI key - see that file for why.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/auth";
import { extractSkillsFromJobDescription } from "@/server/services/faloodAiService";
import { sanitizeApiError } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const currentUser = await getCurrentUserContext();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const jobDescription = body.jobDescription;
  if (!jobDescription) {
    return NextResponse.json({ error: "Missing job description" }, { status: 400 });
  }

  try {
    const skillsData = await extractSkillsFromJobDescription(jobDescription, currentUser?.profile.user_id);
    return NextResponse.json(skillsData);
  } catch (e: any) {
    console.error("[falood/extract-skills] AI call failed:", e);
    return NextResponse.json({ error: sanitizeApiError(e) }, { status: 500 });
  }
}
