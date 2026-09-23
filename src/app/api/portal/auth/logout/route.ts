import { NextResponse } from "next/server";
import { clearCandidateAuthCookie } from "@/server/auth/candidateAuth";

export async function POST() {
  return clearCandidateAuthCookie(NextResponse.json({ ok: true }));
}
