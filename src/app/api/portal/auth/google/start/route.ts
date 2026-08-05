import { NextRequest, NextResponse } from "next/server";
import { candidateGoogleAuthUrl } from "@/server/auth/candidateGoogle";
import { CANDIDATE_OAUTH_STATE_COOKIE } from "@/server/auth/candidateAuth";

// ?invite=<portal_token> is carried through the OAuth round trip via a short-lived
// signed-nothing state cookie (this is a login flow, not the Gmail-read grant, so it
// deliberately does NOT touch integration_oauth_states — that table is reserved for
// provider='gmail' data-access grants).
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const invite = url.searchParams.get("invite") || "";

  const array = new Uint8Array(24);
  crypto.getRandomValues(array);
  const state = btoa(String.fromCharCode(...array)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const response = NextResponse.redirect(candidateGoogleAuthUrl(url.origin, state));
  const secure = process.env.NODE_ENV === "production";
  response.cookies.set(CANDIDATE_OAUTH_STATE_COOKIE, JSON.stringify({ state, invite }), {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 10,
  });
  return response;
}
