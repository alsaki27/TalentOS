import { NextRequest, NextResponse } from "next/server";
import { verifyPassword } from "@/server/auth/crypto";
import { findCandidateByLoginEmail, createCandidateAuthResponse } from "@/server/auth/candidateAuth";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const candidate = await findCandidateByLoginEmail(email);
  if (!candidate || !candidate.password_hash) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const valid = await verifyPassword(password, candidate.password_hash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  return createCandidateAuthResponse(candidate);
}
