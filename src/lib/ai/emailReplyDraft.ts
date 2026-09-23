import { callWithUsageTracking } from "@/lib/ai/routing";
import { textOf } from "@/lib/ai/provider";

export interface ReplyDraft { subject: string; body: string; confidence: number; }

function parse(raw: string): ReplyDraft {
  const clean = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const value = JSON.parse(clean);
  return {
    subject: typeof value.subject === "string" ? value.subject.slice(0, 300) : "Re: Application follow-up",
    body: typeof value.body === "string" ? value.body.slice(0, 6000) : "",
    confidence: typeof value.confidence === "number" ? Math.max(0, Math.min(1, value.confidence)) : 0,
  };
}

export async function draftRecruiterReply(input: { candidateName: string; jobTitle: string | null; company: string | null; subject: string | null; emailBody: string; summary: string | null }): Promise<ReplyDraft> {
  const { result } = await callWithUsageTracking("email_reply_draft", undefined, async (provider) => {
    const response = await provider.send({
      system: "Draft a concise professional recruiter reply for AE review. Never send it. Never invent availability, qualifications, dates, compensation, or commitments. Ask for missing details when needed. Return JSON only.",
      messages: [{ role: "user", content: [{ type: "text", text: [
        "Candidate:", input.candidateName, "Role:", input.jobTitle || "unknown", "Company:", input.company || "unknown",
        "Email subject:", input.subject || "(none)", "AI summary:", input.summary || "(none)", "Original email:", input.emailBody.slice(0, 6000),
        'Return exactly {"subject": string, "body": string, "confidence": number}.',
      ].join("\n") }] }],
      tools: [],
    });
    return parse(textOf(response.content));
  });
  return result;
}
