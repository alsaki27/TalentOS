import { NextResponse } from "next/server";
import { parseSourceOfTruth } from "@/server/services/sourceOfTruthService";
import { getActiveProviderAsync } from "@/lib/ai/index";
import { getGoogleVertexProxyProvider } from "@/lib/ai/googleVertexProxyProvider";
import { getGoogleProvider } from "@/lib/ai/googleProvider";
import { requireCurrentUser } from "@/lib/auth";

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const ctx = await requireCurrentUser();
    if (ctx instanceof NextResponse) return ctx;

    const provider = getGoogleVertexProxyProvider("gemini-2.5-pro")
                  || getGoogleProvider("gemini-2.5-pro")
                  || (await getActiveProviderAsync())?.provider;
                  
    if (!provider) throw new Error("No AI provider configured");

    const sot = await parseSourceOfTruth(params.id, undefined, provider);
    
    return NextResponse.json(sot);
  } catch (err: any) {
    console.error("POST auto-trigger source-of-truth error:", err);
    return new NextResponse(err.message || "Internal server error", { status: 500 });
  }
}
