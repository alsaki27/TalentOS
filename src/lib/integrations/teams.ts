export interface TalentOsNotification {
  event_type?: string;
  external_id?: string;
  title?: string;
  message?: string;
  severity?: "info" | "success" | "warning" | "error";
  candidate?: { name?: string; email?: string };
  job?: { title?: string; company?: string };
  company?: { name?: string };
  application?: { status?: string; id?: string };
  url?: string;
  [key: string]: unknown;
}

function fact(name: string, value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return { name, value: String(value) };
}

export function talentOsTeamsCard(payload: TalentOsNotification) {
  const severity = payload.severity || "info";
  const themeColor = severity === "error" ? "B3261E"
    : severity === "warning" ? "B3541E"
      : severity === "success" ? "2A6F4F"
        : "4A5568";

  const facts = [
    fact("Event", payload.event_type),
    fact("Candidate", payload.candidate?.name),
    fact("Job", payload.job?.title),
    fact("Company", payload.job?.company || payload.company?.name),
    fact("Application status", payload.application?.status),
  ].filter(Boolean);

  return {
    "@type": "MessageCard",
    "@context": "https://schema.org/extensions",
    summary: payload.title || "Talent OS notification",
    themeColor,
    title: payload.title || "Talent OS notification",
    text: payload.message || "A Talent OS notification was received.",
    sections: facts.length ? [{ facts }] : [],
    potentialAction: payload.url ? [{
      "@type": "OpenUri",
      name: "Open in Skarion",
      targets: [{ os: "default", uri: payload.url }],
    }] : [],
  };
}

export async function sendTeamsNotification(payload: TalentOsNotification) {
  const webhookUrl = process.env.TEAMS_TALENT_OS_WEBHOOK_URL;
  if (!webhookUrl) return { sent: false, skipped: true, reason: "TEAMS_TALENT_OS_WEBHOOK_URL is not configured" };

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(talentOsTeamsCard(payload)),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Teams webhook failed (${res.status}) ${text}`.trim());
  }

  return { sent: true, skipped: false };
}
