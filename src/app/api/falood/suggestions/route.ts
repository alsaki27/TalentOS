// src/app/api/falood/suggestions/route.ts
// Chat-driven resume suggestions for the Falood tailor studio. Routed
// through the app's real AI provider system (src/server/services/faloodAiService.ts)
// instead of a hardcoded, quota-exhausted OpenAI key - see that file for why.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/auth";
import { getFaloodSuggestions } from "@/server/services/faloodAiService";
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

  const resumeData = body.resume;
  const jobDescription = body.jobDescription;
  const messages: { role: string; content: string }[] = body.messages ?? [];
  const candidateId: string | undefined = body.candidateId;

  if (!resumeData) {
    return NextResponse.json({ error: "Missing resume data" }, { status: 400 });
  }

  try {
    const suggestionsData = await getFaloodSuggestions(resumeData, jobDescription, messages, currentUser?.profile.user_id, candidateId);
    return NextResponse.json(suggestionsData);
  } catch (e: any) {
    console.error("[falood/suggestions] AI call failed:", e);
    return NextResponse.json({ error: sanitizeApiError(e) }, { status: 500 });
  }
}
