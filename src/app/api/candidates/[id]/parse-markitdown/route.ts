// src/app/api/candidates/[id]/parse-markitdown/route.ts
// POST -> download uploaded resume, extract text, and parse with AI.
// Falls back to AI text extraction when markitdown service is not configured.

import { NextRequest, NextResponse } from "next/server";
import { isNeon } from "@/server/db";
import { query, queryOne } from "@/server/db/neon";
import { convertPdfToMarkdown } from "@/lib/markitdown";
import { parseResumeFromMarkdown, extractText } from "@/lib/resumeParsing";
import { downloadFromSharePoint } from "@/lib/integrations/sharepoint";
import { getProviderForCategory } from "@/lib/ai";
import { textOf } from "@/lib/ai/provider";

// Real PDF text extraction via resumeParsing.ts's extractText - see that file for
// the history of why this isn't pdf-parse or pdfjs-dist (both confirmed broken
// specifically on the Cloudflare Workers deploy, never locally) and is instead a
// hand-rolled extractor using the standard DecompressionStream API to handle real
// PDFs' /FlateDecode-compressed content streams.
async function extractTextFromPDF(buffer: Uint8Array): Promise<string | null> {
  try {
    const text = await extractText(buffer, "application/pdf");
    const trimmed = text.replace(/\s+/g, " ").trim();
    return trimmed.length > 50 ? trimmed : null;
  } catch (err: any) {
    // Logged (not returned to the client - may reflect internals) so a real
    // extraction failure is distinguishable in Cloudflare's logs from "this PDF
    // genuinely has no extractable text" (e.g. a scan).
    console.error("PDF text extraction failed:", err?.message ?? err);
    return null;
  }
}

async function parseResumeWithAI(resumeText: string) {
  const active = await getProviderForCategory("parsing_extraction");
  if (!active) return { error: "No AI provider configured." };

  const prompt = [
    "You are an expert resume parser. Your job is to extract EVERY SINGLE piece of structured information from the resume text below. Be thorough and exhaustive. Do not skip sections. Do not summarize — extract full details.",
    "",
    "RESUME TEXT:",
    resumeText,
    "",
    "Return ONLY a JSON object with this EXACT shape (no markdown code fences, no explanation, no commentary — ONLY the raw JSON object):",
    JSON.stringify({
      name: "full name as written on the resume",
      email: "email address or null",
      phone: "phone number or null",
      linkedin_url: "LinkedIn URL or null",
      github_url: "GitHub URL or null",
      portfolio_url: "portfolio/website URL or null",
      location: "city, state, country or null",
      summary: "full professional summary text or null — extract the complete summary, not a shortened version",
      skills: ["array of EVERY skill mentioned — technical skills, tools, languages, frameworks, soft skills, methodologies. Be specific and exhaustive."],
      experience: [
        {
          title: "job title",
          company: "company name",
          location: "job location or null",
          startDate: "Month Year or Year",
          endDate: "Month Year or null for present/current",
          bullets: ["array of EVERY bullet point, achievement, responsibility. Do not skip any. Extract the full text of each bullet."]
        }
      ],
      education: [
        {
          degree: "degree name (e.g. Bachelor of Science in Computer Science)",
          school: "university or institution name",
          graduationDate: "Month Year or Year or null"
        }
      ],
      certifications: ["array of every certification, license, or credential. Do not skip any."]
    }, null, 2),
    "",
    "CRITICAL RULES:",
    "1. EXTRACT EVERYTHING. Do not skip any section, job, skill, degree, or certification.",
    "2. For skills: list EVERY skill you can find. If the resume has a 'Skills' section, extract all of them. If skills are mentioned in job descriptions, include those too.",
    "3. For experience: create an entry for EVERY job. Extract ALL bullet points for each job — do not summarize, do not truncate. Copy each bullet point verbatim or as close as possible.",
    "4. For education: include EVERY degree, diploma, or certification program.",
    "5. For certifications: include every certification mentioned anywhere in the resume.",
    "6. Dates: use 'Month Year' format (e.g., 'January 2020'). If only year is available, use just the year.",
    "7. Current jobs: set endDate to null.",
    "8. If a field is truly missing from the resume, use null for strings and [] for arrays.",
    "9. DO NOT hallucinate — only extract what is actually in the resume text.",
    "10. Return ONLY the JSON object, no other text."
  ].join("\n");

  const response = await active.provider.send({
    system: "You are an expert resume parser. Extract ALL structured data from resume text and return it as clean JSON only. Be exhaustive — do not skip any sections, jobs, skills, or bullet points.",
    messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
    tools: [],
  });

  const raw = textOf(response.content) ?? "";
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

  let parsed: any;
  try {
    parsed = JSON.parse(stripped);
  } catch (err: any) {
    // Try to extract JSON from within the text if the model wrapped it
    const jsonMatch = stripped.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        throw new Error("AI returned invalid JSON: " + err.message);
      }
    } else {
      throw new Error("AI returned invalid JSON: " + err.message);
    }
  }

  // Normalize the response to ensure consistent shape
  const normalized = {
    name: parsed?.name ?? null,
    email: parsed?.email ?? null,
    phone: parsed?.phone ?? null,
    linkedin_url: parsed?.linkedin_url ?? null,
    github_url: parsed?.github_url ?? null,
    portfolio_url: parsed?.portfolio_url ?? null,
    location: parsed?.location ?? null,
    summary: parsed?.summary ?? null,
    skills: Array.isArray(parsed?.skills) ? parsed.skills : [],
    experience: Array.isArray(parsed?.experience) ? parsed.experience.map((exp: any) => ({
      title: exp?.title ?? "",
      company: exp?.company ?? "",
      location: exp?.location ?? null,
      startDate: exp?.startDate ?? exp?.start_date ?? null,
      endDate: exp?.endDate ?? exp?.end_date ?? null,
      bullets: Array.isArray(exp?.bullets) ? exp.bullets : (exp?.description ? [exp.description] : []),
    })) : [],
    education: Array.isArray(parsed?.education) ? parsed.education.map((edu: any) => ({
      degree: edu?.degree ?? "",
      school: edu?.school ?? "",
      field: edu?.field ?? null,
      graduationDate: edu?.graduationDate ?? edu?.graduation_year ?? null,
    })) : [],
    certifications: Array.isArray(parsed?.certifications) ? parsed.certifications : [],
  };

  // Build a parse status so the user knows what was found
  const parseStatus = {
    hasName: !!normalized.name,
    hasEmail: !!normalized.email,
    hasPhone: !!normalized.phone,
    hasSummary: !!normalized.summary,
    skillsCount: normalized.skills.length,
    experienceCount: normalized.experience.length,
    educationCount: normalized.education.length,
    certificationsCount: normalized.certifications.length,
    totalBulletPoints: normalized.experience.reduce((sum: number, exp: any) => sum + (exp.bullets?.length ?? 0), 0),
  };

  return { parsed: normalized, parseStatus };
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const resumeId = body.resume_id as string | undefined;
  const resumeText = body.resume_text as string | undefined;

  // If user provided resume_text directly, skip PDF download and parse that
  if (resumeText && resumeText.trim().length > 50) {
    try {
      const { parsed, parseStatus } = await parseResumeWithAI(resumeText.trim());
      // Save parsed_json to the resume record if resumeId is provided
      if (resumeId) {
        if (isNeon()) {
          await query('UPDATE resumes SET parsed_json = $1 WHERE id = $2', [parsed, resumeId]);
        } else {
          const { supabase } = await import("@/lib/supabase");
          await supabase.from("resumes").update({ parsed_json: parsed }).eq("id", resumeId);
        }
      }
      return NextResponse.json({ parsed, parseStatus, source: "ai_direct" });
    } catch (err: any) {
      return NextResponse.json({ error: err.message ?? "AI parsing failed" }, { status: 500 });
    }
  }

  if (!resumeId) {
    return NextResponse.json({ error: "resume_id or resume_text is required" }, { status: 400 });
  }

  // 1. Get the resume file URL
  let resume: any;
  if (isNeon()) {
    resume = await queryOne<{ file_url: string; filename: string }>(
      'SELECT file_url, filename FROM resumes WHERE id = $1 AND candidate_id = $2',
      [resumeId, params.id]
    );
  } else {
    const { supabase } = await import("@/lib/supabase");
    const { data } = await supabase
      .from("resumes")
      .select("file_url, filename")
      .eq("id", resumeId)
      .eq("candidate_id", params.id)
      .single();
    resume = data;
  }

  if (!resume) {
    return NextResponse.json({ error: "Resume not found" }, { status: 404 });
  }

  // 2. Download the PDF
  let buffer: Uint8Array;
  try {
    if (resume.file_url.includes("sharepoint.com")) {
      const result = await downloadFromSharePoint(resume.file_url);
      buffer = result.buffer;
    } else {
      const res = await fetch(resume.file_url);
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      buffer = new Uint8Array(await res.arrayBuffer());
    }
  } catch (err: any) {
    return NextResponse.json({ error: `Failed to download resume: ${err.message}` }, { status: 500 });
  }

  // 3. Try markitdown if configured
  const serviceUrl = process.env.MARKITDOWN_SERVICE_URL;
  if (serviceUrl) {
    const mdResult = await convertPdfToMarkdown(buffer, resume.filename);
    if (mdResult.success && mdResult.markdown) {
      const parsed = await parseResumeFromMarkdown(mdResult.markdown);
      if (isNeon()) {
        await query('UPDATE resumes SET parsed_json = $1 WHERE id = $2', [parsed, resumeId]);
      } else {
        const { supabase } = await import("@/lib/supabase");
        await supabase.from("resumes").update({ parsed_json: parsed }).eq("id", resumeId);
      }
      const parseStatus = {
        hasName: !!parsed.name,
        hasEmail: !!parsed.email,
        hasPhone: !!parsed.phone,
        hasSummary: !!parsed.summary,
        skillsCount: parsed.skills.length,
        experienceCount: parsed.experience.length,
        educationCount: parsed.education.length,
        certificationsCount: parsed.certifications.length,
        totalBulletPoints: parsed.experience.reduce((sum: number, exp: any) => sum + (exp.bullets?.length ?? 0), 0),
      };
      return NextResponse.json({ parsed, parseStatus, markdown: mdResult.markdown, source: "markitdown" });
    }
  }

  // 4. Fallback: try simple text extraction from PDF
  const extractedText = await extractTextFromPDF(buffer);
  if (extractedText) {
    try {
      const { parsed, parseStatus } = await parseResumeWithAI(extractedText);
      if (isNeon()) {
        await query('UPDATE resumes SET parsed_json = $1 WHERE id = $2', [parsed, resumeId]);
      } else {
        const { supabase } = await import("@/lib/supabase");
        await supabase.from("resumes").update({ parsed_json: parsed }).eq("id", resumeId);
      }
      return NextResponse.json({ parsed, parseStatus, source: "ai_pdf_extraction" });
    } catch (err: any) {
      return NextResponse.json({ error: err.message ?? "AI parsing failed" }, { status: 500 });
    }
  }

  // 5. Final fallback: ask user to paste resume text
  return NextResponse.json({
    error: "Could not extract text from PDF automatically. The PDF may be image-based or use an unsupported format. Please paste your resume text in the field below and try again.",
    needsManualText: true,
  }, { status: 422 });
}
