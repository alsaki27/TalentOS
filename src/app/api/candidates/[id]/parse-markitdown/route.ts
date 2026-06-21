// src/app/api/candidates/[id]/parse-markitdown/route.ts
// POST -> download uploaded resume, extract text, and parse with AI.
// Falls back to AI text extraction when markitdown service is not configured.

import { NextRequest, NextResponse } from "next/server";
import { isNeon } from "@/server/db";
import { query, queryOne } from "@/server/db/neon";
import { convertPdfToMarkdown } from "@/lib/markitdown";
import { parseResumeFromMarkdown } from "@/lib/resumeParsing";
import { downloadFromSharePoint } from "@/lib/integrations/sharepoint";
import { getActiveProviderAsync } from "@/lib/ai";
import { textOf } from "@/lib/ai/provider";

// Simple text extraction for text-based PDFs.
// Looks for text objects between BT...ET markers and extracts Tj/TJ operands.
// This is not perfect but works for many simple text-based PDFs.
function extractTextFromPDF(buffer: Uint8Array): string | null {
  try {
    const text = new TextDecoder("utf-8").decode(buffer);
    // Try to find text between BT and ET markers
    const btEtMatches = text.match(/BT[\s\S]*?ET/g);
    if (!btEtMatches) return null;

    const extracted: string[] = [];
    for (const block of btEtMatches) {
      // Find Tj (text show) operators: (text) Tj
      const tjMatches = block.match(/\(([^)]*)\)\s*Tj/g);
      if (tjMatches) {
        for (const m of tjMatches) {
          const content = m.match(/\(([^)]*)\)/)?.[1] ?? "";
          // Unescape PDF string escapes
          const unescaped = content
            .replace(/\\n/g, "\n")
            .replace(/\\r/g, "\r")
            .replace(/\\t/g, "\t")
            .replace(/\\b/g, "\b")
            .replace(/\\f/g, "\f")
            .replace(/\\\(/g, "(")
            .replace(/\\\)/g, ")")
            .replace(/\\\\/g, "\\")
            .replace(/\\\d{1,3}/g, (m) => String.fromCharCode(parseInt(m.slice(1), 8)));
          extracted.push(unescaped);
        }
      }

      // Find TJ (text show with positioning) operators: [(text) (text)] TJ
      const tjArrayMatches = block.match(/\[[^\]]*\]\s*TJ/g);
      if (tjArrayMatches) {
        for (const m of tjArrayMatches) {
          const strings = m.match(/\(([^)]*)\)/g);
          if (strings) {
            for (const s of strings) {
              const content = s.slice(1, -1);
              const unescaped = content
                .replace(/\\n/g, "\n")
                .replace(/\\r/g, "\r")
                .replace(/\\t/g, "\t")
                .replace(/\\b/g, "\b")
                .replace(/\\f/g, "\f")
                .replace(/\\\(/g, "(")
                .replace(/\\\)/g, ")")
                .replace(/\\\\/g, "\\")
                .replace(/\\\d{1,3}/g, (m) => String.fromCharCode(parseInt(m.slice(1), 8)));
              extracted.push(unescaped);
            }
          }
        }
      }
    }

    const result = extracted.join(" ").replace(/\s+/g, " ").trim();
    return result.length > 50 ? result : null;
  } catch {
    return null;
  }
}

async function parseResumeWithAI(resumeText: string) {
  const active = await getActiveProviderAsync();
  if (!active) return { error: "No AI provider configured." };

  const prompt = [
    "You are a resume parsing assistant. Extract structured data from the following resume text and return it as a JSON object.",
    "",
    "RESUME TEXT:",
    resumeText,
    "",
    "Return ONLY a JSON object with this exact shape (no markdown fences, no extra text):",
    JSON.stringify({
      name: "string",
      email: "string or null",
      phone: "string or null",
      linkedin_url: "string or null",
      github_url: "string or null",
      portfolio_url: "string or null",
      location: "string or null",
      summary: "string or null",
      skills: ["array of skill strings"],
      experience: [
        {
          title: "string",
          company: "string",
          location: "string or null",
          startDate: "string (Month Year)",
          endDate: "string (Month Year) or null for present",
          bullets: ["array of bullet point strings"]
        }
      ],
      education: [
        {
          degree: "string",
          school: "string",
          graduationDate: "string or null"
        }
      ]
    }, null, 2),
    "",
    "Rules:",
    "1. Extract every piece of information you can find.",
    "2. If something is not in the resume, use null or empty array.",
    "3. For dates, use 'Month Year' format (e.g., 'January 2020').",
    "4. For current jobs, set endDate to null.",
    "5. Return ONLY the JSON object, no other text."
  ].join("\n");

  const response = await active.provider.send({
    system: "You are a precise resume parser. Extract all structured data from resume text and return it as clean JSON only.",
    messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
    tools: [],
  });

  const raw = textOf(response.content);
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const parsed = JSON.parse(stripped);
  return { parsed };
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const resumeId = body.resume_id as string | undefined;
  const resumeText = body.resume_text as string | undefined;

  // If user provided resume_text directly, skip PDF download and parse that
  if (resumeText && resumeText.trim().length > 50) {
    try {
      const { parsed } = await parseResumeWithAI(resumeText.trim());
      // Save parsed_json to the resume record if resumeId is provided
      if (resumeId) {
        if (isNeon()) {
          await query('UPDATE resumes SET parsed_json = $1 WHERE id = $2', [parsed, resumeId]);
        } else {
          const { supabase } = await import("@/lib/supabase");
          await supabase.from("resumes").update({ parsed_json: parsed }).eq("id", resumeId);
        }
      }
      return NextResponse.json({ parsed, source: "ai_direct" });
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
      return NextResponse.json({ parsed, markdown: mdResult.markdown, source: "markitdown" });
    }
  }

  // 4. Fallback: try simple text extraction from PDF
  const extractedText = extractTextFromPDF(buffer);
  if (extractedText) {
    try {
      const { parsed } = await parseResumeWithAI(extractedText);
      if (isNeon()) {
        await query('UPDATE resumes SET parsed_json = $1 WHERE id = $2', [parsed, resumeId]);
      } else {
        const { supabase } = await import("@/lib/supabase");
        await supabase.from("resumes").update({ parsed_json: parsed }).eq("id", resumeId);
      }
      return NextResponse.json({ parsed, source: "ai_pdf_extraction" });
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
