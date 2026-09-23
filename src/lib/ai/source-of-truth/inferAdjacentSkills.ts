import type { AiProvider } from "@/lib/ai/provider";
import { textOf } from "@/lib/ai/provider";
import { z } from "zod";

export interface AdjacentSkillSuggestion {
  skill: string;
  category: string;
  reason: string;
  confidence: "high" | "medium";
}

const SuggestionSchema = z.object({
  skill: z.string(),
  category: z.string(),
  reason: z.string(),
  confidence: z.enum(["high", "medium"]),
});

const ResponseSchema = z.array(SuggestionSchema);

export async function inferAdjacentSkills(
  confirmedSkills: string[],
  provider: AiProvider,
  options?: { maxSuggestions?: number }
): Promise<AdjacentSkillSuggestion[]> {
  const maxSuggestions = options?.maxSuggestions ?? 50;

  if (confirmedSkills.length === 0) {
    return [];
  }

  const prompt = `You are a professional skills inference engine for a talent operations platform.

Given a list of confirmed skills from a candidate's resume, suggest adjacent skills
that a professional with those exact skills would VERY LIKELY also know.
"Very likely" means: 80%+ of practitioners who hold these confirmed skills also
routinely use the suggested skill in the same industry context.

Do NOT suggest:
- Skills from unrelated domains
- Skills that require separate years of specialization
- Certifications or degrees (only tools and methods)
- Skills already in confirmed_skills

OUTPUT FORMAT: Return a JSON array only.
Each item: { "skill": string, "category": string, "reason": string, "confidence": "high"|"medium" }
Maximum ${maxSuggestions} items. No markdown. No explanation.

FEW-SHOT EXAMPLES (calibrate your confidence thresholds to these):
- ArcGIS Pro → QGIS (high), ArcGIS Online (high), ArcMap (medium), 3GIS (medium)
- AutoCAD → MicroStation (high), Civil 3D (medium), Revit (medium)
- Vetro FiberMap → Katapult Pro (high), OSP design workflows (high)
- OSP Design → NESC compliance (high), ROW documentation (high), splice planning (high)
- Python → pandas (high), NumPy (high), Jupyter (medium)
- Excel → Power Query (high), Google Sheets (medium), Power BI (medium)
- Agile → Scrum (high), Jira (high), Confluence (medium)
- Salesforce → HubSpot (medium), Pardot (medium)

CONFIRMED SKILLS:
${JSON.stringify(confirmedSkills)}
`;

  const response = await provider.send({
    system: "You are a professional skills inference engine. Return only valid JSON.",
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: prompt }],
      },
    ],
    tools: [],
    temperature: 0.2, // Low temperature for consistency
    maxTokens: 2000,
  });

  try {
    const raw = textOf(response.content);
    const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(stripped);
    
    const validated = ResponseSchema.parse(parsed);
    return validated;
  } catch (err) {
    console.error("[inferAdjacentSkills] Failed to parse AI response:", err);
    return [];
  }
}
