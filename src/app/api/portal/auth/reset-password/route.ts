import { NextRequest, NextResponse } from "next/server";
import { queryOne, execute } from "@/server/db/neon";
import { hashPassword } from "@/server/auth/crypto";
import { createHash } from "node:crypto";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const token = String(body.token ?? "");
  const password = String(body.password ?? "");
  if (!token || password.length < 8) return NextResponse.json({ error: "Use a valid token and a password of at least 8 characters." }, { status: 400 });
  const row = await queryOne<{ id: string; candidate_id: string }>("SELECT id, candidate_id FROM candidate_password_resets WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()", [createHash("sha256").update(token).digest("hex")]);
  if (!row) return NextResponse.json({ error: "This reset link is invalid or expired." }, { status: 400 });
  await execute("UPDATE candidates SET password_hash = $1 WHERE id = $2", [await hashPassword(password), row.candidate_id]);
  await execute("UPDATE candidate_password_resets SET used_at = NOW() WHERE id = $1", [row.id]);
  return NextResponse.json({ ok: true });
}
