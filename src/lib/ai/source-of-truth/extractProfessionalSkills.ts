import type { AiProvider } from "@/lib/ai/provider";
import { textOf } from "@/lib/ai/provider";
import { z } from "zod";

const ResponseSchema = z.array(z.string());

export async function extractProfessionalSkills(
  resumeContent: any,
  provider: AiProvider
): Promise<string[]> {
  const contentStr = JSON.stringify(resumeContent, null, 2);

  const prompt = `You are a professional skills extraction engine for a top-tier ATS (Applicant Tracking System).
  
Your task is to analyze the provided resume JSON and extract exactly 30 to 40 HIGHLY RELEVANT, PROFESSIONAL hard skills.
You must ensure a minimum 80% relevance/match to the candidate's actual core competencies.

CRITICAL RULES:
1. Do NOT extract generalized action verbs or vague words (e.g., "Developed", "Managed", "Produced", "Dashboards", "Map Layouts", "Assisted", "Conducted", "Integrated", "Created").
2. Only extract specific tools, methodologies, frameworks, languages, platforms, and industry-standard hard skills.
3. Keep the output strictly as a JSON array of strings. No markdown formatting, no explanations.
4. Extract exactly 30 to 40 skills.

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
    const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(stripped);
    
    return ResponseSchema.parse(parsed);
  } catch (err) {
    console.error("[extractProfessionalSkills] Failed to extract skills:", err);
    return [];
  }
}
