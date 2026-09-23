import { NextResponse } from "next/server";
import { clearAuthCookies } from "@/server/auth/session";

export function POST() {
  const response = NextResponse.json({ ok: true });
  return clearAuthCookies(response);
}
