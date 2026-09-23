import { NextRequest, NextResponse } from "next/server";
import { queryOne, execute } from "@/server/db/neon";

export async function PATCH(req: NextRequest, { params }: { params: { token: string } }) {
  const candidate = await queryOne<{ id: string; portal_token_expires_at: string | null; portal_token_revoked_at: string | null }>(
    "SELECT id, portal_token_expires_at, portal_token_revoked_at FROM candidates WHERE portal_token = $1",
    [params.token]
  );
  if (!candidate) return NextResponse.json({ error: "Portal link not found." }, { status: 404 });
  if (candidate.portal_token_revoked_at || (candidate.portal_token_expires_at && new Date(candidate.portal_token_expires_at).getTime() < Date.now())) {
    return NextResponse.json({ error: "Portal link expired." }, { status: 410 });
  }
  const body = await req.json().catch(() => ({}));
  const value = typeof body.enrolledAt === "string" ? body.enrolledAt : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NextResponse.json({ error: "Enter a valid enrollment date." }, { status: 400 });
  const date = new Date(value + "T00:00:00Z");
  const [year, month, day] = value.split("-").map(Number);
  const isRealDate = !Number.isNaN(date.getTime())
    && date.getUTCFullYear() === year
    && date.getUTCMonth() + 1 === month
    && date.getUTCDate() === day;
  if (!isRealDate || date.getTime() > Date.now()) return NextResponse.json({ error: "Enter a real enrollment date that is not in the future." }, { status: 400 });
  await execute("UPDATE candidates SET skarion_enrolled_at = $1 WHERE id = $2", [value, candidate.id]);
  return NextResponse.json({ ok: true, skarionEnrolledAt: value });
}
