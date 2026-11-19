import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Public staff signup is disabled. Ask a TalentOS administrator to create your account." },
    { status: 403 },
  );
}
