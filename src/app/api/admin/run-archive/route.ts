import { NextResponse } from "next/server";

// The original one-off route archived and deleted jobs during a GET request.
// Keep old links harmless; archival now requires a reviewed script.
export async function GET() {
  return NextResponse.json({ error: "The archive route has been retired." }, { status: 410 });
}

export async function POST() {
  return NextResponse.json({ error: "The archive route has been retired." }, { status: 410 });
}
