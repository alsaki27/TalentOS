import { NextResponse } from "next/server";
import { extractProfessionalSkills } from "@/lib/ai/source-of-truth/extractProfessionalSkills";
import { getGoogleVertexProxyProvider } from "@/lib/ai/provider";
import { query } from "@/server/db/neon";
import { requireCurrentUser } from "@/lib/auth";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireCurrentUser();
    if (ctx instanceof NextResponse) return ctx;

    const baseResumes = await query<any>("SELECT * FROM base_resumes WHERE candidate_id = $1 ORDER BY updated_at DESC", [params.id]);
    if (!baseResumes.length) return NextResponse.json({ skills: [] });
    
    const contents = baseResumes.map(br => br.content).filter(c => c && typeof c === "object");
    if (!contents.length) return NextResponse.json({ skills: [] });
    
    const provider = getGoogleVertexProxyProvider("gemini-2.5-pro");
    const extractedSkills = await extractProfessionalSkills(contents, provider);
    
    return NextResponse.json({ skills: extractedSkills });
  } catch (err: any) {
    console.error("Scan only error:", err);
    return new NextResponse(err.message, { status: 500 });
  }
}
