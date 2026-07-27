import { NextResponse } from "next/server";
import { extractProfessionalSkills } from "@/lib/ai/source-of-truth/extractProfessionalSkills";
import { getGoogleVertexProxyProvider } from "@/lib/ai/googleVertexProxyProvider";
import { getGoogleProvider } from "@/lib/ai/googleProvider";
import { getActiveProviderAsync } from "@/lib/ai/index";
import { query } from "@/server/db/neon";
import { requireCurrentUser } from "@/lib/auth";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireCurrentUser();
    if (ctx instanceof NextResponse) return ctx;

    const baseResumes = await query<any>("SELECT * FROM base_resumes WHERE candidate_id = $1 ORDER BY updated_at DESC", [params.id]);
    if (!baseResumes.length) return NextResponse.json({ skills: [] });
    
    const contents = baseResumes.map(br => {
      if (typeof br.content === "string") {
        try { return JSON.parse(br.content); } catch (e) { return br.content; }
      }
      return br.content;
    }).filter(c => !!c);
    
    if (!contents.length) return NextResponse.json({ skills: [], parsedFromResumeName: baseResumes.map(br => br.name || br.filename).filter(Boolean).join(" & ") });
    
    const provider = getGoogleVertexProxyProvider("gemini-2.5-pro")
                  || getGoogleProvider("gemini-2.5-pro")
                  || (await getActiveProviderAsync())?.provider;
                  
    if (!provider) {
      return new NextResponse("AI Provider not configured", { status: 500 });
    }
    const extractedSkills = await extractProfessionalSkills(contents, provider);
    const resumeNames = baseResumes.map(br => br.name || br.filename).filter(Boolean).join(" & ");
    
    return NextResponse.json({ 
      skills: extractedSkills,
      parsedFromResumeName: resumeNames 
    });
  } catch (err: any) {
    console.error("Scan only error:", err);
    return new NextResponse(err.message, { status: 500 });
  }
}
