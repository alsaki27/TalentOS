// Minimal candidate-identity endpoint - used by pages that need just the
// candidate's display name (e.g. the sidebar profile card on the
// application-detail page) without pulling the full dashboard payload.
import { NextResponse } from "next/server";
import { requireCurrentCandidate } from "@/server/auth/candidateAuth";

export const dynamic = "force-dynamic";

export async function GET() {
  const { context, response } = await requireCurrentCandidate();
  if (response) return response;
  return NextResponse.json({ name: context.candidate.name });
}
