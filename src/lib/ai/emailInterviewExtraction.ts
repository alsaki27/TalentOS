import { callWithUsageTracking } from "@/lib/ai/routing";
import { textOf } from "@/lib/ai/provider";

export interface InterviewDetails {
  scheduledAt: string | null;
  timezone: string | null;
  durationMinutes: number | null;
  meetingLink: string | null;
  location: string | null;
  interviewer: string | null;
  responseDeadline: string | null;
  confidence: number;
}

function parse(raw: string): InterviewDetails {
  const clean = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const value = JSON.parse(clean);
  return {
    scheduledAt: typeof value.scheduled_at === "string" ? value.scheduled_at : null,
    timezone: typeof value.timezone === "string" ? value.timezone : null,
    durationMinutes: Number.isFinite(value.duration_minutes) ? Math.max(1, Math.min(480, Number(value.duration_minutes))) : null,
    meetingLink: typeof value.meeting_link === "string" ? value.meeting_link.slice(0, 1000) : null,
    location: typeof value.location === "string" ? value.location.slice(0, 500) : null,
    interviewer: typeof value.interviewer === "string" ? value.interviewer.slice(0, 300) : null,
    responseDeadline: typeof value.response_deadline === "string" ? value.response_deadline : null,
    confidence: typeof value.confidence === "number" ? Math.max(0, Math.min(1, value.confidence)) : 0,
  };
}

export async function extractInterviewDetails(subject: string | null, bodyText: string): Promise<InterviewDetails> {
  const { result } = await callWithUsageTracking("email_interview_extraction", undefined, async (provider) => {
    const response = await provider.send({
      system: "Extract interview logistics from recruiting email. Never infer missing values. Return JSON only.",
      messages: [{ role: "user", content: [{ type: "text", text: [
        "Subject:", subject || "(none)", "Body:", bodyText.slice(0, 6000),
        'Return exactly {"scheduled_at": ISO-8601|null, "timezone": string|null, "duration_minutes": number|null, "meeting_link": string|null, "location": string|null, "interviewer": string|null, "response_deadline": ISO-8601|null, "confidence": number}.',
      ].join("\n") }] }],
      tools: [],
    });
    return parse(textOf(response.content));
  });
  return result;
}
