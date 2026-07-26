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
  
Your task is to analyze the provided resume(s) JSON and extract exactly 30 to 40 HIGHLY RELEVANT, PROFESSIONAL hard skills.
You must ensure a minimum 80% relevance/match to the candidate's actual core competencies based on their experience and education.

CRITICAL RULES:
1. STRICTLY extract only concrete hard skills (e.g., specific programming languages, tools, frameworks, hardware, specialized methodologies, industry standards, certifications).
2. DO NOT extract generalized action verbs, vague words, or soft skills (e.g., "Developed", "Managed", "Produced", "Dashboards", "Map Layouts", "Assisted", "Conducted", "Integrated", "Created", "Leadership", "Communication", "Problem Solving").
3. DO NOT hallucinate. The skill MUST be clearly evidenced in the provided resume experience, education, or skills sections.
4. Keep the output strictly as a JSON array of strings. No markdown formatting, no explanations.
5. Extract exactly 30 to 40 of the absolute strongest skills.

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
