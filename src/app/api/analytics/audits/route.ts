import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { getAuditAnalyticsSummary } from "@/server/db/auditBridge";

export async function GET(req: Request) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  try {
    const url = new URL(req.url);
    const days = Number(url.searchParams.get("days") ?? "90");
    const data = await getAuditAnalyticsSummary(days);
    return NextResponse.json(data);
  } catch (err: any) {
    console.error("GET analytics audits error:", err);
    return new NextResponse(err.message || "Internal server error", { status: 500 });
  }
}
