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
6. Your output MUST be exactly between 30 to 40 skills.
7. Keep the output strictly as a JSON array of strings. No markdown formatting, no explanations.

RESUME CONTENT:
${contentStr}
`;

  try {
    const response = await provider.send({
      system: "You are a professional skills extraction engine. Return only a valid JSON array of strings.",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }],
        },
      ],
      tools: [],
      temperature: 0.1, // Very low temperature for highly deterministic, accurate extraction
      maxTokens: 1500,
    });

    const raw = textOf(response.content);
    const match = raw.match(/\[[\s\S]*\]/);
    const jsonString = match ? match[0] : raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(jsonString);
    
    return ResponseSchema.parse(parsed);
  } catch (err) {
    console.error("[extractProfessionalSkills] Failed to extract skills:", err);
    return [];
  }
}
