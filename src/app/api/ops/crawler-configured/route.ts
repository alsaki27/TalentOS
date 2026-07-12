// src/app/api/ops/crawler-configured/route.ts
// GET -> returns whether the crawler integration is enabled (CRAWLER_API_KEY is set).

import { NextResponse } from "next/server";

export async function GET() {
  const configured = Boolean(process.env.CRAWLER_API_KEY);
  return NextResponse.json({ configured });
}
