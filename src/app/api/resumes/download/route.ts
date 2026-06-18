// src/app/api/resumes/download/route.ts
// GET ?url=<resume url> -> proxies a SharePoint-stored resume through Microsoft Graph so
// the browser can download it without MS auth. Supabase Storage URLs are already public
// and don't need a proxy — this redirects those straight through.
// Mirrors the team's skarion-api `/etl/resume/download` proxy pattern.

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { downloadFromSharePoint } from "@/lib/integrations/sharepoint";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const url = req.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "url is required" }, { status: 400 });

  if (!url.includes("sharepoint.com") && !url.includes("/_layouts/") && !url.includes("graph.microsoft.com")) {
    return NextResponse.redirect(url);
  }

  try {
    const { buffer, contentType, fileName } = await downloadFromSharePoint(url);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Download failed" }, { status: 500 });
  }
}
