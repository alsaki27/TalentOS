import type { AiProvider } from "@/lib/ai/provider";
import { textOf } from "@/lib/ai/provider";

export async function extractProfessionalSkills(
  resumeContents: any[],
  provider: AiProvider
): Promise<string[]> {
  // Strip out heavy UI/styling metadata from Resumify native objects before stringifying
  // so we don't waste tokens or confuse the AI with colors/pagePadding/layout metadata.
  const cleanedContents = resumeContents.map(content => {
    if (content && typeof content === "object" && !Array.isArray(content)) {
      const { colors, pagePadding, sections, typography, layout, theme, history, version, ...relevantData } = content as Record<string, any>;
      return relevantData;
    }
    return content;
  });

  const contentStr = JSON.stringify(cleanedContents, null, 2);

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
7. Return strictly a JSON array of strings. Do not wrap in an object. No markdown formatting, no explanations, no preamble text.

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
      maxTokens: 4000,
    });

    const raw = textOf(response.content);
    console.log("[extractProfessionalSkills] Raw AI response length:", raw?.length ?? 0);
    
    if (!raw || raw.trim().length === 0) {
      console.error("[extractProfessionalSkills] Empty response from AI");
      return [];
    }

    // Clean up markdown code fences or conversational preamble/postamble
    let cleanRaw = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

    let parsed: any = null;

    // Strategy 1: Direct JSON parse of cleaned string
    try {
      parsed = JSON.parse(cleanRaw);
    } catch {
      // Ignore direct parse failure
    }

    // Strategy 2: If direct parse failed or wasn't array/object, find outermost [...] array
    if (!parsed || (typeof parsed !== "object")) {
      const firstBracket = cleanRaw.indexOf('[');
      const lastBracket = cleanRaw.lastIndexOf(']');
      if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
        try {
          parsed = JSON.parse(cleanRaw.substring(firstBracket, lastBracket + 1));
        } catch {
          // If JSON parse failed (e.g. truncated JSON or trailing comma), try cleaning trailing commas
          try {
            const fixedJson = cleanRaw.substring(firstBracket, lastBracket + 1).replace(/,\s*\]/g, "]");
            parsed = JSON.parse(fixedJson);
          } catch {
            // Ignore
          }
        }
      }
    }

    // Strategy 3: If array search failed, find outermost {...} object (in case AI wrapped list in an object)
    if (!parsed || (typeof parsed !== "object")) {
      const firstBrace = cleanRaw.indexOf('{');
      const lastBrace = cleanRaw.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        try {
          parsed = JSON.parse(cleanRaw.substring(firstBrace, lastBrace + 1));
        } catch {
          // Ignore
        }
      }
    }

    // Now convert whatever `parsed` structure we found into a clean array of strings
    let stringArray: string[] = [];

    if (Array.isArray(parsed)) {
      stringArray = parsed.map(item => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object") {
          return String(item.skill || item.name || item.skillName || item.hardSkill || item.title || item.value || Object.values(item)[0] || "").trim();
        }
        return String(item).trim();
      }).filter(Boolean);
    } else if (parsed && typeof parsed === "object") {
      // Search the object for any array property (e.g. parsed.skills, parsed.professionalSkills, parsed.data, etc.)
      for (const val of Object.values(parsed)) {
        if (Array.isArray(val)) {
          stringArray = val.map(item => {
            if (typeof item === "string") return item.trim();
            if (item && typeof item === "object") {
              return String(item.skill || item.name || item.skillName || item.hardSkill || item.title || item.value || Object.values(item)[0] || "").trim();
            }
            return String(item).trim();
          }).filter(Boolean);
          if (stringArray.length > 0) break;
        }
      }
    }

    // Strategy 4: Fallback if JSON parsing completely failed (e.g., AI output a plain bulleted or comma-separated list)
    if (stringArray.length === 0 && typeof cleanRaw === "string" && cleanRaw.length > 0) {
      stringArray = cleanRaw
        .split(/[\n,]+/)
        .map(s => s.replace(/^[-*•\s\d.]+|["'[\]{}:]+|skills?:|professional_skills?:/gi, "").trim())
        .filter(s => s.length > 1 && s.length < 50 && !s.startsWith("```") && !s.includes("{") && !s.includes("}"));
    }

    // Deduplicate and validate
    const uniqueSkills = Array.from(new Set(stringArray.filter(s => typeof s === "string" && s.length > 1 && s.length < 60)));
    console.log("[extractProfessionalSkills] Successfully extracted", uniqueSkills.length, "skills");
    return uniqueSkills;
  } catch (err: any) {
    console.error("[extractProfessionalSkills] Failed to extract skills:", err?.message || err);
    return [];
  }
}
