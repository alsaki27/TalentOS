import type { AiProvider } from "@/lib/ai/provider";
import { textOf } from "@/lib/ai/provider";
import { z } from "zod";

const ResponseSchema = z.array(z.string());

export async function extractProfessionalSkills(
  resumeContents: any[],
  provider: AiProvider
): Promise<string[]> {
  const contentStr = JSON.stringify(resumeContents, null, 2);

  const prompt = `You are an elite, top 1% technical recruiter and professional skills extraction engine for a top-tier ATS.
  
Your task is to analyze the provided resume(s) JSON and extract between 30 to 40 HIGHLY RELEVANT, PROFESSIONAL hard skills.
You must ensure a minimum 80% relevance/match to the candidate's actual core competencies, heavily prioritizing the candidate's core roles, professional experience, and education.

CRITICAL RULES:
1. STRICTLY extract only concrete, professional hard skills (e.g., specific programming languages, tools, software, hardware, specialized methodologies, industry standards, certifications).
2. NEVER extract generalized action verbs, soft skills, or vague buzzwords. (e.g., REJECT "Developed", "Managed", "Produced", "Dashboards", "Assisted", "Leadership", "Communication", "Troubleshooting", "Problem Solving", "Teamwork").
3. NEVER extract broad generic domains like "Software Engineering", "Business", or "Data" unless they represent a specific methodology (e.g., "Agile Software Development").
4. If a term is a common noun (like "Dashboards", "Map Layouts", "Scripts"), it is NOT a valid skill. Only proper nouns and recognized technical terms (like "Tableau", "ArcGIS", "Bash Scripting") are permitted.
5. DO NOT hallucinate. The skill MUST be clearly evidenced in the provided resume experience, education, or skills sections.
6. Your output MUST contain between 30 to 40 skills.
7. Keep the output strictly as a JSON array of strings. No markdown formatting, no explanations, no preamble text.

EXAMPLE OUTPUT FORMAT:
["Python", "React", "PostgreSQL", "Docker", "TypeScript", "AWS S3", "Node.js"]

RESUME CONTENT:
${contentStr}
`;

  try {
    const response = await provider.send({
      system: "You are a professional skills extraction engine. Return ONLY a valid JSON array of strings with no other text, no markdown, no explanation.",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }],
        },
      ],
      tools: [],
      temperature: 0.1,
      maxTokens: 2000,
    });

    const raw = textOf(response.content);
    console.log("[extractProfessionalSkills] Raw AI response length:", raw?.length ?? 0);
    
    if (!raw || raw.trim().length === 0) {
      console.error("[extractProfessionalSkills] Empty response from AI");
      return [];
    }

    // Find the first '[' and last ']' to extract JSON array robustly
    const firstBracket = raw.indexOf('[');
    const lastBracket = raw.lastIndexOf(']');
    
    let parsed: any = [];
    if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
      const jsonString = raw.substring(firstBracket, lastBracket + 1);
      try {
        parsed = JSON.parse(jsonString);
      } catch (e) {
        console.error("[extractProfessionalSkills] JSON parse error:", e, "Raw JSON:", jsonString.substring(0, 200));
        return [];
      }
    } else {
      // Fallback: strip markdown code fences and parse
      const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      try {
        parsed = JSON.parse(stripped);
      } catch (e) {
        console.error("[extractProfessionalSkills] Fallback parse error:", e, "Raw:", raw.substring(0, 200));
        return [];
      }
    }

    if (!Array.isArray(parsed)) {
      console.error("[extractProfessionalSkills] Result is not an array:", typeof parsed);
      return [];
    }

    const result = ResponseSchema.parse(parsed);
    console.log("[extractProfessionalSkills] Successfully extracted", result.length, "skills");
    return result;
  } catch (err: any) {
    console.error("[extractProfessionalSkills] Failed to extract skills:", err?.message || err);
    return [];
  }
}
